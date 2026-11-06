import type { Reading } from './glucose';
import { instantMs } from './time';

const byTime = (a: Reading, b: Reading) => a.time.getTime() - b.time.getTime();

/** Orders text by code point, as the sync engine's byte comparison of UTF-8 does. */
function compareText(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return a.codePointAt(i)! - b.codePointAt(i)!;
  }
  return a.length - b.length;
}

/** Whole seconds, as the engine reads the time the app sends it. */
const takenSecs = (r: Reading) => Math.floor(instantMs(r.time, r.offset) / 1000);

/** True when `a` replaces `b`. Matches `beats` in sync.rs, so both settle a tie in `updated` on the same copy. */
export function beats(a: Reading, b: Reading): boolean {
  const order =
    a.updated - b.updated ||
    Number(a.deleted != null) - Number(b.deleted != null) ||
    a.mmol - b.mmol ||
    compareText(a.unit, b.unit) ||
    compareText(a.context, b.context) ||
    compareText(a.note, b.note) ||
    takenSecs(a) - takenSecs(b);
  return order > 0;
}

/** Folds rows from the sync engine into local rows. `ahead` is true when local had something the engine lacked. */
export function mergeSynced(local: Reading[], incoming: Reading[]): { rows: Reading[]; ahead: boolean } {
  const byId = new Map(incoming.map((r) => [r.id, r]));
  let ahead = false;
  for (const r of local) {
    const other = byId.get(r.id);
    if (!other || beats(r, other)) {
      byId.set(r.id, r);
      ahead = true;
    }
  }
  return { rows: [...byId.values()].sort(byTime), ahead };
}

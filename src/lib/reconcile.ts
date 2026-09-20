import { contentKey, newId } from './csv';
import type { Reading } from './glucose';

const byTime = (a: Reading, b: Reading) => a.time.getTime() - b.time.getTime();
const after = (r: Reading, now: number) => Math.max(now, r.updated + 1);

/** Rows sharing an id get their own; exact copies are dropped. */
export function dedupeIds(rows: Reading[], now = Date.now(), makeId: () => string = newId): { rows: Reading[]; changed: boolean } {
  const first = new Map<string, Reading>();
  const out: Reading[] = [];
  let changed = false;
  for (const r of rows) {
    const original = first.get(r.id);
    if (!original) {
      first.set(r.id, r);
      out.push(r);
      continue;
    }
    changed = true;
    if (contentKey(original) !== contentKey(r)) out.push({ ...r, id: makeId(), updated: now });
  }
  return { rows: out, changed };
}

export interface ExternalEdit {
  rows: Reading[];
  /** Readings missing from the file that were left alone rather than deleted. */
  kept: number;
}

/** Turns a hand-edited file into changes that sync: edits get a fresh stamp, removed lines become tombstones. */
export function reconcileExternal(
  prev: Reading[],
  loaded: Reading[],
  writtenIds: ReadonlySet<string>,
  allLinesRead: boolean,
  now = Date.now(),
): ExternalEdit {
  const before = new Map(prev.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const rows = loaded.map((f) => {
    seen.add(f.id);
    const p = before.get(f.id);
    if (!p || f.updated > p.updated) return f;
    return contentKey(p) === contentKey(f) ? p : { ...f, updated: after(p, now) };
  });
  const missing = prev.filter((p) => !seen.has(p.id));
  const removed = missing.filter((p) => !p.deleted && writtenIds.has(p.id));
  const live = prev.filter((p) => !p.deleted).length;
  const trust = allLinesRead && removed.length <= Math.max(10, Math.floor(live / 10));
  for (const p of missing) {
    rows.push(trust && removed.includes(p) ? { ...p, deleted: now, updated: after(p, now) } : p);
  }
  return { rows: rows.sort(byTime), kept: trust ? 0 : removed.length };
}

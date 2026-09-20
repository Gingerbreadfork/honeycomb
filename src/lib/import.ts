import type { Reading } from './glucose';
import { instantMs } from './time';

export interface ImportPlan {
  total: number;
  add: Reading[];
  existing: number;
  /** Lines in the file that had no usable time or value. */
  skipped: number;
}

const MINUTE = 60_000;
const taken = (r: Reading) => instantMs(r.time, r.offset);

function sameReading(a: Reading, b: Reading): boolean {
  return Math.abs(taken(a) - taken(b)) < MINUTE && Math.abs(a.mmol - b.mmol) < 0.05;
}

/** Live readings grouped by minute, so a match is looked up in the neighbouring minutes only. */
class MinuteIndex {
  private buckets = new Map<number, Reading[]>();

  add(r: Reading): void {
    const key = Math.floor(taken(r) / MINUTE);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(r);
    else this.buckets.set(key, [r]);
  }

  has(r: Reading): boolean {
    const key = Math.floor(taken(r) / MINUTE);
    for (const k of [key - 1, key, key + 1]) {
      if (this.buckets.get(k)?.some((other) => sameReading(other, r))) return true;
    }
    return false;
  }
}

/** Decides which incoming rows are new. Matches by id first, then by time and value. */
export function planImport(current: Reading[], incoming: Reading[], skipped = 0): ImportPlan {
  const ids = new Set(current.map((r) => r.id));
  const live = new MinuteIndex();
  for (const r of current) if (!r.deleted) live.add(r);
  const add: Reading[] = [];
  for (const row of incoming) {
    if (ids.has(row.id)) continue;
    ids.add(row.id);
    if (!row.deleted) {
      if (live.has(row)) continue;
      live.add(row);
    }
    add.push(row);
  }
  return { total: incoming.length, add, existing: incoming.length - add.length, skipped };
}

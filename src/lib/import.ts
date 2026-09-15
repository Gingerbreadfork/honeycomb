import type { Reading } from './glucose';

export interface ImportPlan {
  total: number;
  add: Reading[];
  existing: number;
}

function sameReading(a: Reading, b: Reading): boolean {
  return Math.abs(a.time.getTime() - b.time.getTime()) < 60_000 && Math.abs(a.mmol - b.mmol) < 0.05;
}

/** Decides which incoming rows are new. Matches by id first, then by time and value. */
export function planImport(current: Reading[], incoming: Reading[]): ImportPlan {
  const byId = new Map(current.map((r) => [r.id, r]));
  const live = current.filter((r) => !r.deleted);
  const add: Reading[] = [];
  const seen = new Set<string>();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (byId.has(row.id)) continue;
    if (!row.deleted && live.some((r) => sameReading(r, row))) continue;
    if (add.some((r) => !r.deleted && !row.deleted && sameReading(r, row))) continue;
    add.push(row);
  }
  return { total: incoming.length, add, existing: incoming.length - add.length };
}

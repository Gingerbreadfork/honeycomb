import type { Reading } from './glucose';

const byTime = (a: Reading, b: Reading) => a.time.getTime() - b.time.getTime();

/** Folds rows from the sync engine into local rows. `ahead` is true when local had something the engine lacked. */
export function mergeSynced(local: Reading[], incoming: Reading[]): { rows: Reading[]; ahead: boolean } {
  const byId = new Map(incoming.map((r) => [r.id, r]));
  let ahead = false;
  for (const r of local) {
    const other = byId.get(r.id);
    if (!other || r.updated > other.updated) {
      byId.set(r.id, r);
      ahead = true;
    }
  }
  return { rows: [...byId.values()].sort(byTime), ahead };
}

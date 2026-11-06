import { contentKey, newId } from './csv';
import type { Reading } from './glucose';

const byTime = (a: Reading, b: Reading) => a.time.getTime() - b.time.getTime();
const after = (r: Reading, now: number) => Math.max(now, r.updated + 1);

/** How long a deletion is remembered, so a device that was away can still learn of it. Matches the sync engine. */
export const TOMBSTONE_KEEP_MS = 730 * 24 * 60 * 60 * 1000;

export function dropExpiredTombstones(rows: Reading[], now = Date.now()): { rows: Reading[]; changed: boolean } {
  const kept = rows.filter((r) => !r.deleted || r.deleted + TOMBSTONE_KEEP_MS >= now);
  return { rows: kept, changed: kept.length !== rows.length };
}

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

/** Each row's `contentKey` as the file held it when the app last read or wrote it. */
export function diskKeys(rows: Reading[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const r of rows) if (!keys.has(r.id)) keys.set(r.id, contentKey(r));
  return keys;
}

/**
 * Turns a hand-edited file into changes that sync: edits get a fresh stamp, removed lines become tombstones.
 * A line still as `onDisk` recorded it was not edited, so the app's own newer copy of that row stays.
 */
export function reconcileExternal(
  prev: Reading[],
  loaded: Reading[],
  onDisk: ReadonlyMap<string, string>,
  allLinesRead: boolean,
  now = Date.now(),
): ExternalEdit {
  const before = new Map(prev.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const rows = loaded.map((f) => {
    seen.add(f.id);
    const p = before.get(f.id);
    if (!p || f.updated > p.updated) return f;
    const key = contentKey(f);
    const last = onDisk.get(f.id);
    if (key === contentKey(p) || last === undefined || key === last) return p;
    return { ...f, updated: after(p, now) };
  });
  const missing = prev.filter((p) => !seen.has(p.id));
  const removed = missing.filter((p) => !p.deleted && onDisk.has(p.id));
  const live = prev.filter((p) => !p.deleted).length;
  const trust = allLinesRead && removed.length <= Math.max(10, Math.floor(live / 10));
  for (const p of missing) {
    rows.push(trust && removed.includes(p) ? { ...p, deleted: now, updated: after(p, now) } : p);
  }
  return { rows: rows.sort(byTime), kept: trust ? 0 : removed.length };
}

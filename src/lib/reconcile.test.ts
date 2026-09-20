import { describe, expect, it } from 'vitest';
import { dedupeIds, dropExpiredTombstones, reconcileExternal, TOMBSTONE_KEEP_MS } from './reconcile';
import type { Reading } from './glucose';

const r = (id: string, minutes: number, mmol: number, updated = 100): Reading => ({
  id,
  time: new Date(2026, 8, 15, 8, minutes),
  mmol,
  unit: 'mmol/L',
  context: '',
  note: '',
  updated,
  deleted: null,
});

describe('dedupeIds', () => {
  it('gives a copied line its own id and drops exact copies', () => {
    const { rows, changed } = dedupeIds([r('a', 0, 6.4), r('a', 0, 6.4), r('a', 30, 7.1)], 500, () => 'fresh');
    expect(changed).toBe(true);
    expect(rows.map((x) => [x.id, x.mmol, x.updated])).toEqual([
      ['a', 6.4, 100],
      ['fresh', 7.1, 500],
    ]);
  });
});

describe('dropExpiredTombstones', () => {
  it('forgets deletions older than the keep time and nothing else', () => {
    const now = 5 * TOMBSTONE_KEEP_MS;
    const rows = [r('live', 0, 6), { ...r('old', 1, 6), deleted: now - TOMBSTONE_KEEP_MS - 1 }, { ...r('recent', 2, 6), deleted: now - 1000 }];
    const out = dropExpiredTombstones(rows, now);
    expect(out.rows.map((x) => x.id)).toEqual(['live', 'recent']);
    expect(out.changed).toBe(true);
  });
});

describe('reconcileExternal', () => {
  const prev = [r('a', 0, 6.4), r('b', 30, 7.1), r('c', 60, 5.5)];
  const saved = new Set(['a', 'b', 'c']);

  it('stamps a hand-edited row so the edit wins on other devices', () => {
    const { rows } = reconcileExternal(prev, [r('a', 0, 6.4), r('b', 30, 9.9), r('c', 60, 5.5)], saved, true, 900);
    expect(rows.find((x) => x.id === 'b')).toMatchObject({ mmol: 9.9, updated: 900 });
    expect(rows.find((x) => x.id === 'a')?.updated).toBe(100);
  });

  it('turns a removed line into a tombstone', () => {
    const { rows, kept } = reconcileExternal(prev, [r('a', 0, 6.4), r('c', 60, 5.5)], saved, true, 900);
    expect(kept).toBe(0);
    expect(rows.find((x) => x.id === 'b')).toMatchObject({ deleted: 900, updated: 900 });
  });

  it('leaves a reading alone when it was never written to the file', () => {
    const unsaved = [...prev, r('new', 90, 8.0)];
    const { rows } = reconcileExternal(unsaved, prev, saved, true, 900);
    expect(rows.find((x) => x.id === 'new')?.deleted).toBeNull();
  });

  it('deletes nothing when lines were unreadable or most of the file is gone', () => {
    const unreadable = reconcileExternal(prev, [r('a', 0, 6.4)], saved, false, 900);
    expect(unreadable.kept).toBe(2);
    expect(unreadable.rows.every((x) => !x.deleted)).toBe(true);
    const many = Array.from({ length: 40 }, (_, i) => r(`m${i}`, i, 6));
    const gutted = reconcileExternal(many, many.slice(0, 5), new Set(many.map((x) => x.id)), true, 900);
    expect(gutted.kept).toBe(35);
    expect(gutted.rows.filter((x) => x.deleted)).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { planImport } from './import';
import type { Reading } from './glucose';

const r = (id: string, minutes: number, mmol: number, deleted: number | null = null): Reading => ({
  id,
  time: new Date(2026, 8, 15, 8, minutes),
  mmol,
  unit: 'mmol/L',
  context: '',
  note: '',
  updated: 1,
  deleted,
});

describe('planImport', () => {
  it('skips rows already present by id or by time and value', () => {
    const current = [r('a', 0, 6.4), r('b', 30, 7.1)];
    const plan = planImport(current, [r('a', 0, 6.4), r('other', 30, 7.1), r('c', 60, 5.5), r('c', 60, 5.5)]);
    expect(plan.total).toBe(4);
    expect(plan.add.map((x) => x.id)).toEqual(['c']);
    expect(plan.existing).toBe(3);
  });

  it('matches across a minute boundary and within the file itself', () => {
    const at = (id: string, ms: number): Reading => ({ ...r(id, 0, 6.4), time: new Date(Date.UTC(2026, 8, 15, 8, 0, 0) + ms) });
    const plan = planImport([at('a', 59_500)], [at('b', 60_200), at('c', 300_000), at('d', 300_400)]);
    expect(plan.add.map((x) => x.id)).toEqual(['c']);
  });

  it('plans a large file quickly', () => {
    const many = Array.from({ length: 60_000 }, (_, i) => r(`n${i}`, i * 5, 6 + (i % 40) / 10));
    const t0 = performance.now();
    expect(planImport(many.slice(0, 30_000), many).add).toHaveLength(30_000);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('keeps tombstones from a full export so deletions carry over', () => {
    const plan = planImport([], [r('gone', 0, 6.0, 5)]);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].deleted).toBe(5);
  });
});

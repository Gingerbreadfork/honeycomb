import { describe, expect, it } from 'vitest';
import { dailyAverages } from './stats';
import type { Reading } from './glucose';

const reading = (d: Date, mmol: number): Reading => ({ id: d.getTime().toString(36), time: d, mmol, unit: 'mmol/L', context: '', note: '', updated: 1, deleted: null });

describe('dailyAverages', () => {
  const from = new Date(2026, 9, 10);
  const to = new Date(2026, 9, 14);
  const readings = [
    reading(new Date(2026, 9, 9, 23, 30), 12),
    reading(new Date(2026, 9, 10, 8), 5),
    reading(new Date(2026, 9, 10, 20), 7),
    reading(new Date(2026, 9, 12, 7, 15), 6.5),
    reading(new Date(2026, 9, 14, 0, 5), 9),
  ];

  it('gives one entry per day of the span, oldest first', () => {
    const days = dailyAverages(readings, from, to);
    expect(days.map((d) => d.start.getDate())).toEqual([10, 11, 12, 13]);
  });

  it('averages each day and tracks its count and spread', () => {
    const [first, , third] = dailyAverages(readings, from, to);
    expect(first.mean).toBe(6);
    expect(first.count).toBe(2);
    expect(first.min).toBe(5);
    expect(first.max).toBe(7);
    expect(third.mean).toBe(6.5);
    expect(third.count).toBe(1);
  });

  it('leaves days without readings empty', () => {
    const days = dailyAverages(readings, from, to);
    expect(days[1]).toEqual({ start: new Date(2026, 9, 11), mean: null, count: 0, min: null, max: null });
    expect(days[3].mean).toBeNull();
  });

  it('ignores readings outside the span', () => {
    const days = dailyAverages(readings, from, to);
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(3);
  });

  it('starts from the beginning of the first day', () => {
    const days = dailyAverages(readings, new Date(2026, 9, 10, 15), new Date(2026, 9, 11));
    expect(days).toHaveLength(1);
    expect(days[0].start.getTime()).toBe(new Date(2026, 9, 10).getTime());
    expect(days[0].count).toBe(2);
  });
});

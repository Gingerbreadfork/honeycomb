import { describe, expect, it } from 'vitest';
import { detectDayOrder, parseTime } from './time';
import { parseReadings } from './csv';

const ymdhm = (d: Date | null) => (d ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()] : null);

describe('parseTime', () => {
  it('reads numeric dates in either order, with or without seconds', () => {
    expect(ymdhm(parseTime('15/09/2026 08:42'))).toEqual([2026, 9, 15, 8, 42, 0]);
    expect(ymdhm(parseTime('15/09/2026 08:42:10'))).toEqual([2026, 9, 15, 8, 42, 10]);
    expect(ymdhm(parseTime('9/15/2026 8:42 PM', 'mdy'))).toEqual([2026, 9, 15, 20, 42, 0]);
    expect(ymdhm(parseTime('03/04/2026 08:42:10', 'mdy'))).toEqual([2026, 3, 4, 8, 42, 10]);
    expect(ymdhm(parseTime('15.09.2026 08:42'))).toEqual([2026, 9, 15, 8, 42, 0]);
  });

  it('rejects out-of-range parts instead of rolling into another year', () => {
    expect(parseTime('03/25/2026 08:42')).toBeNull();
    expect(parseTime('31/02/2026 08:42')).toBeNull();
    expect(parseTime('2026-13-01 08:00')).toBeNull();
    expect(parseTime('15/09/2026 25:00')).toBeNull();
  });

  it('reads fractional seconds', () => {
    expect(parseTime('2026-09-15 08:42:07.5')?.getMilliseconds()).toBe(500);
  });
});

describe('detectDayOrder', () => {
  it('uses any value that can only be read one way', () => {
    expect(detectDayOrder(['03/04/2026 08:00', '03/25/2026 09:00'])).toBe('mdy');
    expect(detectDayOrder(['03/04/2026', '25/03/2026'])).toBe('dmy');
    expect(detectDayOrder(['03/04/2026', '05/06/2026'])).toBeNull();
    expect(detectDayOrder(['2026-09-15T08:00:00'])).toBeNull();
  });

  it('applies the detected order to the whole file', () => {
    const us = 'Date,Glucose\n03/04/2026 08:00,100\n03/25/2026 09:00,120\n';
    const { readings, skipped } = parseReadings(us, 'mg/dL');
    expect(skipped).toBe(0);
    expect(readings.map((r) => [r.time.getMonth() + 1, r.time.getDate()])).toEqual([
      [3, 4],
      [3, 25],
    ]);
  });
});

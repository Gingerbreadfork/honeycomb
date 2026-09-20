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

describe('reading times keep their own clock', () => {
  it('shows the wall time that was recorded and writes the same text back', async () => {
    const { parseStamp, instantMs, toLocalIso } = await import('./time');
    for (const text of ['2026-09-15T08:42:00-03:30', '2026-01-20T23:05:10+13:00', '2026-06-01T12:00:00+00:00']) {
      const stamp = parseStamp(text)!;
      expect([stamp.time.getHours(), stamp.time.getMinutes()]).toEqual([+text.slice(11, 13), +text.slice(14, 16)]);
      expect(instantMs(stamp.time, stamp.offset)).toBe(Date.parse(text));
      expect(toLocalIso(stamp.time, false, stamp.offset)).toBe(text);
    }
  });

  it('treats a time without an offset, or in UTC "Z", as this device\'s', async () => {
    const { parseStamp, instantMs } = await import('./time');
    const bare = parseStamp('2026-09-15 08:42')!;
    expect(bare.offset).toBeNull();
    expect(instantMs(bare.time, bare.offset)).toBe(bare.time.getTime());
    const utc = parseStamp('2026-09-15T08:42:00Z')!;
    expect(utc.offset).toBeNull();
    expect(utc.time.getTime()).toBe(Date.parse('2026-09-15T08:42:00Z'));
  });

  it('survives a trip through the data file', async () => {
    const { readingsFromCsv, readingsToCsv } = await import('./csv');
    const file = 'time,glucose,unit,context,note,id,updated,deleted\n2026-09-15T08:42:00-07:00,6.4,mmol/L,fasting,,abc,2026-09-15T08:42:07.512-07:00,\n';
    const rows = readingsFromCsv(file, 'mmol/L');
    expect(rows[0].time.getHours()).toBe(8);
    expect(rows[0].offset).toBe(-420);
    expect(rows[0].updated).toBe(Date.parse('2026-09-15T08:42:07.512-07:00'));
    expect(readingsToCsv(rows).split('\n')[1].startsWith('2026-09-15T08:42:00-07:00,')).toBe(true);
  });
});

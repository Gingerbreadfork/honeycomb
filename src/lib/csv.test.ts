import { describe, expect, it } from 'vitest';
import { parseCsv, readingsFromCsv, readingsToCleanCsv, readingsToCsv, serializeCsv } from './csv';

describe('csv', () => {
  it('parses quoted fields, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('round-trips readings including notes with commas and newlines', () => {
    const text = readingsToCsv([
      { id: '1', time: new Date(2026, 8, 15, 8, 42), mmol: 6.4, unit: 'mmol/L', context: 'fasting', note: 'toast, jam\nlate', updated: 1000, deleted: null },
      { id: '2', time: new Date(2026, 8, 14, 22, 5), mmol: 180 / 18.0182, unit: 'mg/dL', context: '', note: '', updated: 2000, deleted: 3000 },
    ]);
    const back = readingsFromCsv(text, 'mmol/L');
    expect(back).toHaveLength(2);
    expect(back[0].unit).toBe('mg/dL');
    expect(Math.round(back[0].mmol * 18.0182)).toBe(180);
    expect(back[1].note).toBe('toast, jam\nlate');
    expect(back[1].context).toBe('fasting');
    expect(back[1].time.getHours()).toBe(8);
    expect(back[0].id).toBe('2');
    expect(back[0].deleted).not.toBeNull();
    expect(back[1].updated).toBe(1000);
  });

  it('gives legacy rows a stable id and hides tombstones from the clean export', () => {
    const legacy = 'time,glucose,unit,context,note\n2026-09-01T07:30:00+10:00,6.1,mmol/L,fasting,\n';
    const a = readingsFromCsv(legacy, 'mmol/L');
    const b = readingsFromCsv(legacy, 'mmol/L');
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].updated).toBe(a[0].time.getTime());
    const clean = readingsToCleanCsv([{ ...a[0], deleted: 5 }, { ...a[0], id: 'x', deleted: null }]);
    expect(clean.split('\n').filter(Boolean)).toHaveLength(2);
    expect(clean.startsWith('time,glucose,unit,context,note\n')).toBe(true);
  });

  it('tolerates other column names and separate date and time columns', () => {
    const text = 'Date,Time,Blood Glucose (mg/dL),Notes\n2026-09-01,07:30,126,before run\n';
    const r = readingsFromCsv(text, 'mmol/L');
    expect(r).toHaveLength(1);
    expect(r[0].unit).toBe('mg/dL');
    expect(r[0].mmol).toBeCloseTo(7.0, 1);
    expect(r[0].time.getMinutes()).toBe(30);
  });

  it('serializes with quoting only when needed', () => {
    expect(serializeCsv([['a', 'b c', 'd,e']])).toBe('a,b c,"d,e"\n');
  });
});

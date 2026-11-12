import { describe, expect, it } from 'vitest';
import { parseCsv, parseReadings, readingsFromCsv, readingsToCleanCsv, readingsToCsv, serializeCsv } from './csv';

describe('csv', () => {
  it('parses quoted fields, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('reports the file line of each row it could not read', () => {
    const text = [
      'time,glucose,note',
      '2026-09-15 08:00,6.4,"two',
      'lines"',
      '',
      '2026-09-15 09:00,typo,',
      '2026-09-15 10:00,7.0,',
      'not a time,5.0,',
    ].join('\r\n');
    const parsed = parseReadings(text, 'mmol/L');
    expect(parsed.readings).toHaveLength(2);
    expect(parsed.skipped).toBe(2);
    expect(parsed.skippedLines).toEqual([5, 7]);
  });

  it('keeps the first reading of a file without a header once columns are picked', () => {
    const text = 'Glucose export\n2026-09-15 08:00,6.4\n2026-09-15 09:00,7.1\n2026-09-15 10:00,5.5\n';
    expect(parseReadings(text, 'mmol/L')).toMatchObject({ readings: [], skipped: 2, headers: ['2026-09-15 08:00', '6.4'] });
    const picked = parseReadings(text, 'mmol/L', { time: 0, glucose: 1 });
    expect(picked.readings.map((r) => r.mmol)).toEqual([6.4, 7.1, 5.5]);
    expect(picked.skipped).toBe(0);
    const unnamed = parseReadings('Datum,Wert\n2026-09-15 08:00,6.4\n', 'mmol/L', { time: 0, glucose: 1 });
    expect(unnamed.readings).toHaveLength(1);
    expect(unnamed.skipped).toBe(0);
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

  it('reads values to the precision the file is saved with', () => {
    const text = 'time,glucose,unit\n2026-09-15T08:42:00+10:00,6.44,mmol/L\n2026-09-15T09:42:00+10:00,6.35,mmol/L\n2026-09-15T10:42:00+10:00,110.6,mg/dL\n';
    const first = readingsFromCsv(text, 'mmol/L');
    expect(first.map((r) => r.mmol)).toEqual([6.4, 6.4, 111 / 18.0182]);
    const again = readingsFromCsv(readingsToCsv(first), 'mmol/L');
    expect(again.map((r) => r.mmol)).toEqual(first.map((r) => r.mmol));
  });

  it('keeps sync stamps to the millisecond and still reads whole-second files', () => {
    const stamp = 1789925573216;
    const reading = { id: 'a', time: new Date(stamp), mmol: 5.5, unit: 'mmol/L' as const, context: '' as const, note: '', updated: stamp, deleted: stamp + 7 };
    const back = readingsFromCsv(readingsToCsv([reading]), 'mmol/L')[0];
    expect(back.updated).toBe(stamp);
    expect(back.deleted).toBe(stamp + 7);
    const old = 'time,glucose,unit,context,note,id,updated,deleted\n2026-09-15T08:42:00+10:00,6.4,mmol/L,,,k3,2026-09-15T08:42:31+10:00,\n';
    expect(new Date(readingsFromCsv(old, 'mmol/L')[0].updated).getSeconds()).toBe(31);
  });

  it('does not take a column that merely contains "id" as the row id', () => {
    const meter = 'Timestamp,Glucose Value (mg/dL),Source Device ID\n2026-09-01T08:00:00,100,PHONE1\n2026-09-01T12:00:00,140,PHONE1\n';
    const ids = readingsFromCsv(meter, 'mg/dL').map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('PHONE1');
  });

  it('gives legacy rows a stable id and hides tombstones from the clean export', () => {
    const legacy = 'time,glucose,unit,context,note\n2026-09-01T07:30:00+10:00,6.1,mmol/L,fasting,\n';
    const a = readingsFromCsv(legacy, 'mmol/L');
    const b = readingsFromCsv(legacy, 'mmol/L');
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].updated).toBe(Date.parse('2026-09-01T07:30:00+10:00'));
    expect(a[0].time.getHours()).toBe(7);
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

  it('reads a file that names no unit in one unit throughout', () => {
    const mgdl = 'time,glucose\n2026-09-15 08:00,30\n2026-09-15 12:00,112\n2026-09-15 18:00,140\n';
    expect(parseReadings(mgdl, 'mmol/L').readings.map((r) => r.unit)).toEqual(['mg/dL', 'mg/dL', 'mg/dL']);
    expect(parseReadings(mgdl, 'mmol/L').readings[0].mmol).toBeCloseTo(1.66, 1);
    const mmol = 'time,glucose\n2026-09-15 08:00,6.4\n2026-09-15 12:00,22.5\n2026-09-15 18:00,5\n';
    expect(parseReadings(mmol, 'mg/dL').readings.map((r) => [r.unit, r.mmol])).toEqual([
      ['mmol/L', 6.4],
      ['mmol/L', 22.5],
      ['mmol/L', 5],
    ]);
    const eitherWay = 'time,glucose\n2026-09-15 08:00,30\n';
    expect(parseReadings(eitherWay, 'mmol/L').readings[0].unit).toBe('mmol/L');
    expect(parseReadings(eitherWay, 'mg/dL').readings[0].unit).toBe('mg/dL');
  });

  it('serializes with quoting only when needed', () => {
    expect(serializeCsv([['a', 'b c', 'd,e']])).toBe('a,b c,"d,e"\n');
  });
});

describe('meter exports and hand-picked columns', () => {
  const libre = [
    'Glucose Data,Generated on,15-09-2026 08:00 UTC,Generated by,Someone',
    'Device,Serial Number,Device Timestamp,Record Type,Historic Glucose mmol/L,Scan Glucose mmol/L,Notes,Strip Glucose mmol/L',
    'FreeStyle LibreLink,ABC,14-09-2026 07:45,0,6.1,,,',
    'FreeStyle LibreLink,ABC,14-09-2026 12:10,1,,8.3,,',
    'FreeStyle LibreLink,ABC,14-09-2026 22:30,2,,,,5.2',
    'FreeStyle LibreLink,ABC,14-09-2026 23:00,6,,,felt shaky,',
  ].join('\n');

  it('finds the header under a title line and reads whichever glucose column is filled', async () => {
    const { parseReadings } = await import('./csv');
    const file = parseReadings(libre, 'mg/dL');
    expect(file.headers[2]).toBe('Device Timestamp');
    expect(file.readings.map((r) => [r.time.getDate(), r.time.getHours(), r.mmol, r.unit])).toEqual([
      [14, 7, 6.1, 'mmol/L'],
      [14, 12, 8.3, 'mmol/L'],
      [14, 22, 5.2, 'mmol/L'],
    ]);
    expect(file.skipped).toBe(1);
  });

  it('reads a file with unfamiliar headers once the columns are picked', async () => {
    const { parseReadings } = await import('./csv');
    const odd = 'Logged,Wert,Bemerkung\n2026-09-14 07:45,112,nüchtern\n2026-09-14 12:10,160,\n';
    const guessed = parseReadings(odd, 'mmol/L');
    expect(guessed.readings).toHaveLength(0);
    expect([guessed.time, guessed.glucose, guessed.skipped]).toEqual([-1, -1, 2]);
    expect(guessed.headers).toEqual(['Logged', 'Wert', 'Bemerkung']);
    const picked = parseReadings(odd, 'mmol/L', { time: 0, glucose: 1 });
    expect(picked.readings.map((r) => Math.round(r.mmol * 18.0182))).toEqual([112, 160]);
    const forced = parseReadings('When,Level\n2026-09-14 07:45,12\n', 'mg/dL', { time: 0, glucose: 1, unit: 'mmol/L' });
    expect(forced.readings[0]).toMatchObject({ mmol: 12, unit: 'mmol/L' });
  });
});

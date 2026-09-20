import { normalizeContext, type Reading, type Unit } from './glucose';
import { detectDayOrder, instantMs, localeDayOrder, parseStamp, parseTime, toLocalIso } from './time';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function escapeField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function serializeCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeField).join(',')).join('\n') + '\n';
}

export const HEADER = ['time', 'glucose', 'unit', 'context', 'note', 'id', 'updated', 'deleted'];
export const CLEAN_HEADER = ['time', 'glucose', 'unit', 'context', 'note'];

const COLS = {
  time: ['time', 'timestamp', 'datetime', 'date_time', 'date time', 'taken', 'when'],
  date: ['date', 'day'],
  clock: ['time of day', 'clock'],
  glucose: ['glucose', 'value', 'reading', 'bg', 'blood glucose', 'blood_glucose', 'blood sugar', 'level', 'sugar', 'result'],
  unit: ['unit', 'units'],
  context: ['context', 'tag', 'type', 'meal', 'event', 'label'],
  note: ['note', 'notes', 'comment', 'comments'],
  id: ['id'],
  updated: ['updated'],
  deleted: ['deleted'],
};

function findCol(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = headers.findIndex((h) => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

/** For columns whose name must match outright: "id" should not pick up "Device ID". */
function exactCol(headers: string[], names: string[]): number {
  return names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Stable id for rows written before ids existed, so every device derives the same one. */
export function legacyId(time: Date, value: string, unit: string, context: string, note: string): string {
  const text = `${time.getTime()}|${value}|${unit}|${context}|${note}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return `l${h1.toString(36)}${h2.toString(36)}`;
}

function unitFrom(raw: string): Unit | null {
  const s = raw.toLowerCase();
  if (s.includes('mg')) return 'mg/dL';
  if (s.includes('mmol')) return 'mmol/L';
  return null;
}

export function readingsFromCsv(text: string, fallbackUnit: Unit): Reading[] {
  return parseReadings(text, fallbackUnit).readings;
}

/** `skipped` counts data lines that had no usable time or value. */
export function parseReadings(text: string, fallbackUnit: Unit): { readings: Reading[]; skipped: number } {
  const rows = parseCsv(text);
  if (!rows.length) return { readings: [], skipped: 0 };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  let timeCol = findCol(headers, COLS.time);
  const dateCol = exactCol(headers, COLS.date);
  const glucoseCol = findCol(headers, COLS.glucose);
  const unitCol = findCol(headers, COLS.unit);
  const contextCol = findCol(headers, COLS.context);
  const noteCol = findCol(headers, COLS.note);
  const idCol = exactCol(headers, COLS.id);
  const updatedCol = exactCol(headers, COLS.updated);
  const deletedCol = exactCol(headers, COLS.deleted);
  let clockCol = -1;
  if (timeCol < 0 && dateCol >= 0) {
    timeCol = dateCol;
    clockCol = headers.findIndex((h, i) => i !== dateCol && h === 'time');
  } else if (timeCol >= 0 && dateCol >= 0 && headers[timeCol] === 'time') {
    clockCol = timeCol;
    timeCol = dateCol;
  }
  if (timeCol < 0 || glucoseCol < 0) return { readings: [], skipped: rows.length - 1 };
  const headerUnit = unitFrom(headers[glucoseCol]);
  const dayOrder = detectDayOrder(rows.slice(1).map((r) => r[timeCol] ?? '')) ?? localeDayOrder();

  const out: Reading[] = [];
  for (const r of rows.slice(1)) {
    const timeText = clockCol >= 0 ? `${r[timeCol] ?? ''} ${r[clockCol] ?? ''}` : (r[timeCol] ?? '');
    const stamp = parseStamp(timeText, dayOrder);
    const time = stamp?.time ?? null;
    const offset = stamp?.offset ?? null;
    const value = Number((r[glucoseCol] ?? '').trim().replace(',', '.'));
    if (!time || !Number.isFinite(value) || value <= 0) continue;
    const unit: Unit =
      (unitCol >= 0 ? unitFrom(r[unitCol] ?? '') : null) ?? headerUnit ?? (value > 35 ? 'mg/dL' : fallbackUnit);
    const mmol = unit === 'mmol/L' ? value : value / 18.0182;
    const context = normalizeContext(contextCol >= 0 ? (r[contextCol] ?? '') : '');
    const note = noteCol >= 0 ? (r[noteCol] ?? '').trim() : '';
    const id = (idCol >= 0 ? (r[idCol] ?? '').trim() : '') || legacyId(new Date(instantMs(time, offset)), (r[glucoseCol] ?? '').trim(), unit, context, note);
    const updatedText = updatedCol >= 0 ? (r[updatedCol] ?? '').trim() : '';
    const taken = instantMs(time, offset);
    const updated = updatedText ? (parseTime(updatedText)?.getTime() ?? taken) : taken;
    const deletedText = deletedCol >= 0 ? (r[deletedCol] ?? '').trim() : '';
    const deleted = deletedText ? (parseTime(deletedText)?.getTime() ?? null) : null;
    out.push({ id, time, offset, mmol, unit, context, note, updated, deleted });
  }
  out.sort((a, b) => a.time.getTime() - b.time.getTime());
  return { readings: out, skipped: rows.length - 1 - out.length };
}

function valueText(r: Reading): string {
  return r.unit === 'mmol/L' ? (Math.round(r.mmol * 10) / 10).toFixed(1) : String(Math.round(r.mmol * 18.0182));
}

/** A row as it appears on disk, without the sync columns. */
export function contentKey(r: Reading): string {
  return [toLocalIso(r.time, false, r.offset), valueText(r), r.unit, r.context, r.note, r.deleted ? 'deleted' : ''].join('\u001f');
}

/** The full file, including sync columns and deleted rows kept as tombstones. */
export function readingsToCsv(readings: Reading[]): string {
  const sorted = [...readings].sort((a, b) => a.time.getTime() - b.time.getTime());
  const rows = sorted.map((r) => [
    toLocalIso(r.time, false, r.offset),
    valueText(r),
    r.unit,
    r.context,
    r.note,
    r.id,
    toLocalIso(new Date(r.updated), true),
    r.deleted ? toLocalIso(new Date(r.deleted), true) : '',
  ]);
  return serializeCsv([HEADER, ...rows]);
}

/** A tidy five-column file for sharing, without deleted rows or sync columns. */
export function readingsToCleanCsv(readings: Reading[]): string {
  const sorted = readings.filter((r) => !r.deleted).sort((a, b) => a.time.getTime() - b.time.getTime());
  const rows = sorted.map((r) => [toLocalIso(r.time, false, r.offset), valueText(r), r.unit, r.context, r.note]);
  return serializeCsv([CLEAN_HEADER, ...rows]);
}

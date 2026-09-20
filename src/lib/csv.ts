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

/** Columns picked by hand in the import dialog, overriding what the headers suggest. */
export interface ColumnChoice {
  time?: number;
  glucose?: number;
  unit?: Unit;
}

export interface ParsedFile {
  readings: Reading[];
  /** Data lines that had no usable time or value. */
  skipped: number;
  /** Header cells as written, and the time and glucose columns used; -1 when none was found. */
  headers: string[];
  time: number;
  glucose: number;
}

interface Layout {
  time: number;
  clock: number;
  glucose: number[];
}

function layoutOf(headers: string[]): Layout | null {
  let time = findCol(headers, COLS.time);
  const date = exactCol(headers, COLS.date);
  let clock = -1;
  if (time < 0 && date >= 0) {
    time = date;
    clock = headers.findIndex((h, i) => i !== date && h === 'time');
  } else if (time >= 0 && date >= 0 && headers[time] === 'time') {
    clock = time;
    time = date;
  }
  const first = findCol(headers, COLS.glucose);
  if (time < 0 || first < 0) return null;
  // Meter exports split values across columns such as "Scan Glucose" and "Strip Glucose".
  const others = headers.map((h, i) => (i !== first && h.includes('glucose') ? i : -1)).filter((i) => i >= 0);
  return { time, clock, glucose: [first, ...others] };
}

const HEADER_SEARCH = 12;

/** Meter exports often start with a title line, so the header is the first early row that names a time and a glucose column. */
function findHeaderRow(rows: string[][]): number {
  const early = rows.slice(0, HEADER_SEARCH);
  const named = early.findIndex((r) => layoutOf(r.map((h) => h.trim().toLowerCase())) !== null);
  if (named >= 0) return named;
  const widest = Math.max(...early.map((r) => r.length));
  return early.findIndex((r) => r.length === widest);
}

export function parseReadings(text: string, fallbackUnit: Unit, choice: ColumnChoice = {}): ParsedFile {
  const all = parseCsv(text);
  if (!all.length) return { readings: [], skipped: 0, headers: [], time: -1, glucose: -1 };
  const headerRow = findHeaderRow(all);
  const shown = all[headerRow].map((h) => h.trim());
  const headers = shown.map((h) => h.toLowerCase());
  const rows = all.slice(headerRow + 1);
  const guessed = layoutOf(headers);
  const timeCol = choice.time ?? guessed?.time ?? -1;
  const clockCol = choice.time === undefined || choice.time === guessed?.time ? (guessed?.clock ?? -1) : -1;
  const glucoseCols = choice.glucose !== undefined ? [choice.glucose] : (guessed?.glucose ?? []);
  const found = { headers: shown, time: timeCol, glucose: glucoseCols[0] ?? -1 };
  if (timeCol < 0 || !glucoseCols.length) return { readings: [], skipped: rows.length, ...found };

  const unitCol = findCol(headers, COLS.unit);
  const contextCol = findCol(headers, COLS.context);
  const noteCol = findCol(headers, COLS.note);
  const idCol = exactCol(headers, COLS.id);
  const updatedCol = exactCol(headers, COLS.updated);
  const deletedCol = exactCol(headers, COLS.deleted);
  const dayOrder = detectDayOrder(rows.map((r) => r[timeCol] ?? '')) ?? localeDayOrder();

  const out: Reading[] = [];
  for (const r of rows) {
    const timeText = clockCol >= 0 ? `${r[timeCol] ?? ''} ${r[clockCol] ?? ''}` : (r[timeCol] ?? '');
    const stamp = parseStamp(timeText, dayOrder);
    const glucoseCol = glucoseCols.find((c) => (r[c] ?? '').trim() !== '') ?? glucoseCols[0];
    const valueText = (r[glucoseCol] ?? '').trim();
    const value = Number(valueText.replace(',', '.'));
    if (!stamp || !Number.isFinite(value) || value <= 0) continue;
    const { time, offset } = stamp;
    const unit: Unit =
      choice.unit ??
      (unitCol >= 0 ? unitFrom(r[unitCol] ?? '') : null) ??
      unitFrom(headers[glucoseCol]) ??
      (value > 35 ? 'mg/dL' : fallbackUnit);
    const mmol = unit === 'mmol/L' ? value : value / 18.0182;
    const context = normalizeContext(contextCol >= 0 ? (r[contextCol] ?? '') : '');
    const note = noteCol >= 0 ? (r[noteCol] ?? '').trim() : '';
    const taken = instantMs(time, offset);
    const id = (idCol >= 0 ? (r[idCol] ?? '').trim() : '') || legacyId(new Date(taken), valueText, unit, context, note);
    const updatedText = updatedCol >= 0 ? (r[updatedCol] ?? '').trim() : '';
    const updated = updatedText ? (parseTime(updatedText)?.getTime() ?? taken) : taken;
    const deletedText = deletedCol >= 0 ? (r[deletedCol] ?? '').trim() : '';
    const deleted = deletedText ? (parseTime(deletedText)?.getTime() ?? null) : null;
    out.push({ id, time, offset, mmol, unit, context, note, updated, deleted });
  }
  out.sort((a, b) => a.time.getTime() - b.time.getTime());
  return { readings: out, skipped: rows.length - out.length, ...found };
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

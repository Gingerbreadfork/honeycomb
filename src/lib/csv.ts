import { LIMITS, normalizeContext, roundForUnit, toMmol, type Reading, type Unit } from './glucose';
import { detectDayOrder, instantMs, localeDayOrder, parseStamp, parseTime, toLocalIso } from './time';

interface CsvRow {
  cells: string[];
  /** The line of the file the row starts on, counting from 1. */
  line: number;
}

function parseCsvRows(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
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
      } else {
        field += c;
        if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
      }
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
      rows.push({ cells: row, line: start });
      row = [];
      start = ++line;
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push({ cells: row, line: start });
  }
  return rows.filter((r) => r.cells.some((f) => f.trim() !== ''));
}

export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).map((r) => r.cells);
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

/**
 * The unit of a file's values when nothing in it names one. Values over the mmol/L range can only be
 * mg/dL and values under the mg/dL range only mmol/L; whichever the file has more of decides for all
 * of it, and `fallback` when neither does.
 */
function unitOfValues(values: number[], fallback: Unit): Unit {
  const mgdl = values.filter((v) => v > LIMITS['mmol/L'][1]).length;
  const mmol = values.filter((v) => v < LIMITS['mg/dL'][0]).length;
  if (mgdl === mmol) return fallback;
  return mgdl > mmol ? 'mg/dL' : 'mmol/L';
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
  /** Where each of those lines is in the file, counting from 1. */
  skippedLines: number[];
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

/**
 * Meter exports often start with a title line, so the header is the first early row that names a time and a glucose column.
 * Without one, the widest early row stands in, and `named` is false.
 */
function findHeaderRow(rows: string[][]): { row: number; named: boolean } {
  const early = rows.slice(0, HEADER_SEARCH);
  const named = early.findIndex((r) => layoutOf(r.map((h) => h.trim().toLowerCase())) !== null);
  if (named >= 0) return { row: named, named: true };
  const widest = Math.max(...early.map((r) => r.length));
  return { row: early.findIndex((r) => r.length === widest), named: false };
}

export function parseReadings(text: string, fallbackUnit: Unit, choice: ColumnChoice = {}): ParsedFile {
  const lines = parseCsvRows(text);
  const all = lines.map((r) => r.cells);
  if (!all.length) return { readings: [], skipped: 0, skippedLines: [], headers: [], time: -1, glucose: -1 };
  const header = findHeaderRow(all);
  const shown = all[header.row].map((h) => h.trim());
  const headers = shown.map((h) => h.toLowerCase());
  // A stand-in header may be the first reading, so it is read as data too, and not counted when it isn't one.
  const start = header.named ? header.row + 1 : header.row;
  const rows = all.slice(start);
  const lineOf = (i: number) => lines[start + i].line;
  const counts = (i: number) => header.named || i > 0;
  const guessed = layoutOf(headers);
  const timeCol = choice.time ?? guessed?.time ?? -1;
  const clockCol = choice.time === undefined || choice.time === guessed?.time ? (guessed?.clock ?? -1) : -1;
  const glucoseCols = choice.glucose !== undefined ? [choice.glucose] : (guessed?.glucose ?? []);
  const found = { headers: shown, time: timeCol, glucose: glucoseCols[0] ?? -1 };
  if (timeCol < 0 || !glucoseCols.length) {
    const skippedLines = rows.flatMap((_, i) => (counts(i) ? [lineOf(i)] : []));
    return { readings: [], skipped: skippedLines.length, skippedLines, ...found };
  }

  const unitCol = findCol(headers, COLS.unit);
  const contextCol = findCol(headers, COLS.context);
  const noteCol = findCol(headers, COLS.note);
  const idCol = exactCol(headers, COLS.id);
  const updatedCol = exactCol(headers, COLS.updated);
  const deletedCol = exactCol(headers, COLS.deleted);
  const dayOrder = detectDayOrder(rows.map((r) => r[timeCol] ?? '')) ?? localeDayOrder();

  const usable: { r: string[]; stamp: NonNullable<ReturnType<typeof parseStamp>>; value: number; valueText: string; unit: Unit | null }[] = [];
  const skippedLines: number[] = [];
  for (const [i, r] of rows.entries()) {
    const timeText = clockCol >= 0 ? `${r[timeCol] ?? ''} ${r[clockCol] ?? ''}` : (r[timeCol] ?? '');
    const stamp = parseStamp(timeText, dayOrder);
    const glucoseCol = glucoseCols.find((c) => (r[c] ?? '').trim() !== '') ?? glucoseCols[0];
    const valueText = (r[glucoseCol] ?? '').trim();
    const value = Number(valueText.replace(',', '.'));
    if (!stamp || !Number.isFinite(value) || value <= 0) {
      if (counts(i)) skippedLines.push(lineOf(i));
      continue;
    }
    const unit = choice.unit ?? (unitCol >= 0 ? unitFrom(r[unitCol] ?? '') : null) ?? unitFrom(headers[glucoseCol]);
    usable.push({ r, stamp, value, valueText, unit });
  }
  const unnamed = unitOfValues(usable.flatMap((u) => (u.unit ? [] : [u.value])), fallbackUnit);

  const out: Reading[] = [];
  for (const { r, stamp, value, valueText, ...row } of usable) {
    const { time, offset } = stamp;
    const unit = row.unit ?? unnamed;
    // Kept to the precision the file is written with, so a reading reads back the same after a save.
    const mmol = toMmol(roundForUnit(value, unit), unit);
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
  return { readings: out, skipped: skippedLines.length, skippedLines, ...found };
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

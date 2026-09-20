export type Unit = 'mmol/L' | 'mg/dL';
export const UNITS: Unit[] = ['mmol/L', 'mg/dL'];

const FACTOR = 18.0182;

export function toMmol(value: number, unit: Unit): number {
  return unit === 'mmol/L' ? value : value / FACTOR;
}

export function fromMmol(mmol: number, unit: Unit): number {
  return unit === 'mmol/L' ? mmol : mmol * FACTOR;
}

export function roundForUnit(value: number, unit: Unit): number {
  return unit === 'mmol/L' ? Math.round(value * 10) / 10 : Math.round(value);
}

export function formatValue(mmol: number, unit: Unit): string {
  const v = fromMmol(mmol, unit);
  return unit === 'mmol/L' ? v.toFixed(1) : String(Math.round(v));
}

export function formatSigned(mmolDelta: number, unit: Unit): string {
  const v = fromMmol(mmolDelta, unit);
  const rounded = unit === 'mmol/L' ? Math.round(v * 10) / 10 : Math.round(v);
  const text = unit === 'mmol/L' ? Math.abs(rounded).toFixed(1) : String(Math.abs(rounded));
  if (rounded === 0) return unit === 'mmol/L' ? '0.0' : '0';
  return (rounded > 0 ? '+' : '−') + text;
}

export const LIMITS: Record<Unit, [number, number]> = {
  'mmol/L': [1, 35],
  'mg/dL': [20, 630],
};

/** Parses typed input in the given unit. Returns mmol/L, or null when not a usable number. */
export function parseInput(text: string, unit: Unit): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const v = Number(cleaned);
  const [lo, hi] = LIMITS[unit];
  if (!(v >= lo && v <= hi)) return null;
  return toMmol(roundForUnit(v, unit), unit);
}

export function inputHint(text: string, unit: Unit): string | null {
  const cleaned = text.trim().replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return 'Numbers only';
  const v = Number(cleaned);
  const [lo, hi] = LIMITS[unit];
  if (v < lo) return `Meters read from ${lo} ${unit}`;
  if (v > hi) return `Meters read up to ${hi} ${unit}`;
  return null;
}

export type Status = 'very-low' | 'low' | 'in-range' | 'high' | 'very-high';
export type Tone = 'low' | 'in' | 'high' | 'very-high';

export interface Targets {
  low: number;
  high: number;
}

export const DEFAULT_TARGETS: Targets = { low: 3.9, high: 10.0 };
export const VERY_LOW = 3.0;
export const VERY_HIGH = 13.9;

/** Checks typed targets in the display unit; they have to sit inside the fixed very-low and very-high marks. */
export function targetsProblem(low: number, high: number, unit: Unit): string | null {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 'Targets need to be numbers';
  const floor = roundForUnit(fromMmol(VERY_LOW, unit), unit);
  const ceiling = roundForUnit(fromMmol(VERY_HIGH, unit), unit);
  if (low < floor) return `The low target can't be under ${formatValue(VERY_LOW, unit)} ${unit}, where readings count as very low`;
  if (high > ceiling) return `The high target can't be over ${formatValue(VERY_HIGH, unit)} ${unit}, where readings count as very high`;
  if (high <= low) return 'The high target has to be above the low one';
  return null;
}

export function statusOf(mmol: number, t: Targets): Status {
  if (mmol < VERY_LOW) return 'very-low';
  if (mmol < t.low) return 'low';
  if (mmol > VERY_HIGH) return 'very-high';
  if (mmol > t.high) return 'high';
  return 'in-range';
}

export const STATUS_LABEL: Record<Status, string> = {
  'very-low': 'Very low',
  low: 'Low',
  'in-range': 'In range',
  high: 'High',
  'very-high': 'Very high',
};

export function toneOf(status: Status): Tone {
  if (status === 'low' || status === 'very-low') return 'low';
  if (status === 'very-high') return 'very-high';
  if (status === 'high') return 'high';
  return 'in';
}

export type Context = '' | 'fasting' | 'before meal' | 'after meal' | 'bedtime';

export const CONTEXTS: { value: Context; label: string }[] = [
  { value: 'fasting', label: 'Fasting' },
  { value: 'before meal', label: 'Before meal' },
  { value: 'after meal', label: 'After meal' },
  { value: 'bedtime', label: 'Bedtime' },
];

export function normalizeContext(raw: string): Context {
  const s = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!s) return '';
  if (s.startsWith('fast')) return 'fasting';
  if (s.startsWith('before') || s.startsWith('pre')) return 'before meal';
  if (s.startsWith('after') || s.startsWith('post')) return 'after meal';
  if (s.startsWith('bed') || s.startsWith('night')) return 'bedtime';
  return '';
}

export function contextLabel(c: Context): string {
  return CONTEXTS.find((x) => x.value === c)?.label ?? '';
}

export interface Reading {
  id: string;
  time: Date;
  mmol: number;
  unit: Unit;
  context: Context;
  note: string;
  updated: number;
  deleted: number | null;
}

/** Glucose management indicator: an A1c estimate from average glucose. */
export function gmi(meanMmol: number): number {
  return 3.31 + 0.02392 * fromMmol(meanMmol, 'mg/dL');
}

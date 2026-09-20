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

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];
export type Timing = 'before' | 'after';
export type Context = '' | 'fasting' | 'bedtime' | 'exercise' | 'unwell' | `${Timing} meal` | `${Timing} ${Meal}`;

/** The chips shown first. Before and After can then be narrowed to a meal. */
export const CONTEXTS: { value: Context; label: string }[] = [
  { value: 'fasting', label: 'Fasting' },
  { value: 'before meal', label: 'Before meal' },
  { value: 'after meal', label: 'After meal' },
  { value: 'bedtime', label: 'Bedtime' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'unwell', label: 'Unwell' },
];

export function timingOf(c: Context): Timing | null {
  return c.startsWith('before ') ? 'before' : c.startsWith('after ') ? 'after' : null;
}

export function mealOf(c: Context): Meal | null {
  const word = c.split(' ')[1];
  return timingOf(c) && (MEALS as readonly string[]).includes(word) ? (word as Meal) : null;
}

export function mealContext(timing: Timing, meal: Meal | null): Context {
  return `${timing} ${meal ?? 'meal'}`;
}

export function isContext(s: string): s is Context {
  if (['', 'fasting', 'bedtime', 'exercise', 'unwell'].includes(s)) return true;
  const [timing, what, extra] = s.split(' ');
  return extra === undefined && (timing === 'before' || timing === 'after') && (what === 'meal' || (MEALS as readonly string[]).includes(what));
}

/** Reads contexts written by hand or by other apps, such as "Pre-breakfast" or "post lunch". */
export function normalizeContext(raw: string): Context {
  const s = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!s) return '';
  if (isContext(s)) return s;
  const timing: Timing | null = /^(before|pre)\b/.test(s) ? 'before' : /^(after|post)\b/.test(s) ? 'after' : null;
  if (timing) {
    const meal = /breakfast/.test(s) ? 'breakfast' : /lunch/.test(s) ? 'lunch' : /dinner|supper|evening meal/.test(s) ? 'dinner' : /snack/.test(s) ? 'snack' : null;
    return mealContext(timing, meal);
  }
  if (s.startsWith('fast')) return 'fasting';
  if (s.startsWith('bed') || s.startsWith('night')) return 'bedtime';
  if (/^(exercis|workout|sport|gym|training)/.test(s)) return 'exercise';
  if (/^(unwell|ill|sick)/.test(s)) return 'unwell';
  return '';
}

export function contextLabel(c: Context): string {
  return c ? c[0].toUpperCase() + c.slice(1) : '';
}

export interface Reading {
  id: string;
  /** Wall-clock time where the reading was taken; see `offset`. */
  time: Date;
  /** That place's zone in minutes east of UTC. Missing means this device's zone. */
  offset?: number | null;
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

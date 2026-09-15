import { gmi, statusOf, toneOf, type Reading, type Targets, type Tone } from './glucose';
import { addDays, dayKey, startOfDay } from './time';

export interface TirSplit {
  low: number;
  inRange: number;
  high: number;
}

export interface Stats {
  count: number;
  days: number;
  perDay: number;
  mean: number | null;
  sd: number | null;
  cv: number | null;
  min: Reading | null;
  max: Reading | null;
  tir: TirSplit | null;
  tirCounts: TirSplit;
  a1c: number | null;
  fastingMean: number | null;
  fastingCount: number;
}

export function computeStats(readings: Reading[], targets: Targets, spanDays?: number): Stats {
  const n = readings.length;
  const counts: TirSplit = { low: 0, inRange: 0, high: 0 };
  let sum = 0;
  let min: Reading | null = null;
  let max: Reading | null = null;
  let fastingSum = 0;
  let fastingCount = 0;
  const dayKeys = new Set<string>();
  for (const r of readings) {
    sum += r.mmol;
    if (!min || r.mmol < min.mmol) min = r;
    if (!max || r.mmol > max.mmol) max = r;
    const tone = toneOf(statusOf(r.mmol, targets));
    if (tone === 'low') counts.low++;
    else if (tone === 'high' || tone === 'very-high') counts.high++;
    else counts.inRange++;
    if (r.context === 'fasting') {
      fastingSum += r.mmol;
      fastingCount++;
    }
    dayKeys.add(dayKey(r.time));
  }
  const mean = n ? sum / n : null;
  let sd: number | null = null;
  if (mean !== null && n > 1) {
    let ss = 0;
    for (const r of readings) ss += (r.mmol - mean) ** 2;
    sd = Math.sqrt(ss / (n - 1));
  }
  const days = spanDays ?? dayKeys.size;
  return {
    count: n,
    days,
    perDay: days ? n / days : 0,
    mean,
    sd,
    cv: mean && sd !== null ? sd / mean : null,
    min,
    max,
    tir: n ? { low: counts.low / n, inRange: counts.inRange / n, high: counts.high / n } : null,
    tirCounts: counts,
    a1c: mean !== null && n >= 3 ? gmi(mean) : null,
    fastingMean: fastingCount ? fastingSum / fastingCount : null,
    fastingCount,
  };
}

export function filterRange(readings: Reading[], from: Date, to: Date): Reading[] {
  const a = from.getTime();
  const b = to.getTime();
  return readings.filter((r) => {
    const t = r.time.getTime();
    return t >= a && t < b;
  });
}

export interface DayGroup {
  key: string;
  date: Date;
  readings: Reading[];
}

/** Newest day first, newest reading first within a day. */
export function groupByDay(readings: Reading[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const r of readings) {
    const key = dayKey(r.time);
    let g = map.get(key);
    if (!g) {
      g = { key, date: startOfDay(r.time), readings: [] };
      map.set(key, g);
    }
    g.readings.push(r);
  }
  const groups = [...map.values()];
  groups.sort((a, b) => b.date.getTime() - a.date.getTime());
  for (const g of groups) g.readings.sort((a, b) => b.time.getTime() - a.time.getTime());
  return groups;
}

export interface Bucket {
  start: Date;
  end: Date;
  label: string;
  counts: TirSplit;
  total: number;
}

/** Splits a span into day or week buckets with time-in-range counts. */
export function tirBuckets(readings: Reading[], targets: Targets, from: Date, to: Date, byWeek: boolean): Bucket[] {
  const buckets: Bucket[] = [];
  let cursor = startOfDay(from);
  while (cursor < to) {
    const end = addDays(cursor, byWeek ? 7 : 1);
    buckets.push({ start: cursor, end, label: '', counts: { low: 0, inRange: 0, high: 0 }, total: 0 });
    cursor = end;
  }
  for (const r of readings) {
    const t = r.time.getTime();
    const b = buckets.find((x) => t >= x.start.getTime() && t < x.end.getTime());
    if (!b) continue;
    const tone: Tone = toneOf(statusOf(r.mmol, targets));
    if (tone === 'low') b.counts.low++;
    else if (tone === 'high' || tone === 'very-high') b.counts.high++;
    else b.counts.inRange++;
    b.total++;
  }
  return buckets;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

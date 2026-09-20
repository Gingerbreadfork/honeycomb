const pad2 = (n: number) => String(n).padStart(2, '0');

export function toLocalIso(d: Date, withMs = false): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    (withMs ? `.${String(d.getMilliseconds()).padStart(3, '0')}` : '') +
    `${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`
  );
}

export type DayOrder = 'dmy' | 'mdy';

const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?)?)?$/i;

/** Null when any part is out of range, rather than rolling over into another month or year. */
function localDate(y: number, mo: number, d: number, h = 12, mi = 0, sec = 0, ms = 0): Date | null {
  if (h > 23 || mi > 59 || sec > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, sec, ms);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

/** Works out whether dates like 03/04/2026 put the day or the month first. Null when no value settles it. */
export function detectDayOrder(samples: string[]): DayOrder | null {
  let dayFirst = false;
  let monthFirst = false;
  for (const text of samples) {
    const m = text.trim().match(NUMERIC_DATE);
    if (!m) continue;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
  }
  if (dayFirst === monthFirst) return null;
  return dayFirst ? 'dmy' : 'mdy';
}

export function localeDayOrder(): DayOrder {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2026, 0, 2));
    const month = parts.findIndex((p) => p.type === 'month');
    const day = parts.findIndex((p) => p.type === 'day');
    return month >= 0 && month < day ? 'mdy' : 'dmy';
  } catch {
    return 'dmy';
  }
}

export function parseTime(raw: string, order: DayOrder = 'dmy'): Date | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    if (m[8]) {
      const d = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      return isNaN(d.getTime()) ? null : d;
    }
    return localDate(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, m[7] ? +m[7].padEnd(3, '0') : 0);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return localDate(+m[1], +m[2], +m[3]);
  m = s.match(NUMERIC_DATE);
  if (m) {
    const [day, month] = order === 'dmy' ? [+m[1], +m[2]] : [+m[2], +m[1]];
    let h = m[4] ? +m[4] : 12;
    if (m[7]) {
      if (h < 1 || h > 12) return null;
      const pm = m[7].toLowerCase() === 'p';
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return localDate(+m[3], month, day, h, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function dateInputValue(d: Date): string {
  return dayKey(d);
}

export function timeInputValue(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromInputs(date: string, time: string): Date | null {
  const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = time.match(/^(\d{1,2}):(\d{2})/);
  if (!dm || !tm) return null;
  const d = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0);
  return isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function hourOfDay(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}

let hour12 = true;

export function setHour12(v: boolean): void {
  hour12 = v;
}

export function systemHour12(): boolean {
  try {
    const r = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    return r.hour12 ?? true;
  } catch {
    return true;
  }
}

function tidyPeriod(s: string): string {
  return s.replace(/[\s  ]*([AP])M/i, (_, p: string) => ` ${p.toLowerCase()}m`).replace(/\./g, '');
}

export function fmtTime(d: Date): string {
  const s = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12 }).format(d);
  return hour12 ? tidyPeriod(s) : s;
}

export function fmtHourTick(h: number): string {
  if (h === 0 || h === 24) return 'Midnight';
  if (h === 12) return 'Noon';
  if (hour12) return `${h % 12} ${h < 12 ? 'am' : 'pm'}`;
  return `${pad2(h)}:00`;
}

export function fmtDayHeading(d: Date, now = new Date()): string {
  if (isSameDay(d, now)) return 'Today';
  if (isSameDay(d, addDays(now, -1))) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    weekday: sameYear ? 'long' : 'short',
    day: 'numeric',
    month: sameYear ? 'long' : 'short',
    year: sameYear ? undefined : 'numeric',
  }).format(d);
}

export function fmtShortDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(d);
}

export function fmtWeekday(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d);
}

export function fmtDateTime(d: Date, now = new Date()): string {
  if (isSameDay(d, now)) return `Today, ${fmtTime(d)}`;
  if (isSameDay(d, addDays(now, -1))) return `Yesterday, ${fmtTime(d)}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  }).format(d);
  return `${date}, ${fmtTime(d)}`;
}

export function fmtRelative(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const d = new Date(ms);
  return fmtDateTime(d, new Date(now)).toLowerCase();
}

export function fmtLongDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export function fmtRange(from: Date, to: Date): string {
  const sameYear = from.getFullYear() === to.getFullYear();
  const f = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
  const t = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f.format(from)} to ${t.format(to)}`;
}

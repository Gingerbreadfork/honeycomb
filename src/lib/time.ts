const pad2 = (n: number) => String(n).padStart(2, '0');

export function toLocalIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    `${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`
  );
}

export function parseTime(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    if (m[7]) {
      const d = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      return isNaN(d.getTime()) ? null : d;
    }
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})\s*([ap]m)?)?$/i);
  if (m) {
    let h = m[4] ? +m[4] : 12;
    if (m[6]) {
      const pm = m[6].toLowerCase() === 'pm';
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return new Date(+m[3], +m[2] - 1, +m[1], h, m[5] ? +m[5] : 0);
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

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    cache.set(tz, f);
  }
  return f;
}

function parts(ms: number, tz: string): Parts & { s: number } {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year!, m: o.month!, d: o.day!, h: o.hour!, mi: o.minute!, s: o.second! };
}

function offset(ms: number, tz: string): number {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  const first = guess - offset(guess, tz);
  return new Date(guess - offset(first, tz));
}

const pad = (n: number) => String(n).padStart(2, '0');

export function isoToLocalInput(iso: string | null, tz: string): string {
  if (!iso) return '';
  const p = parts(Date.parse(iso), tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

export function localInputToIso(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz).toISOString();
}

export function dateKey(iso: string, tz: string): string {
  const p = parts(Date.parse(iso), tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export const todayKey = (tz: string) => dateKey(new Date().toISOString(), tz);

export function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, timeStyle: 'short' }).format(new Date(iso));
}

export function monthRange(year: number, month: number, tz: string): { from: string; to: string } {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return {
    from: zonedToUtc(year, month, 1, 0, 0, tz).toISOString(),
    to: zonedToUtc(next.y, next.m, 1, 0, 0, tz).toISOString(),
  };
}

export const timeZones = (): string[] => {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = supported ? supported('timeZone') : [];
  return list.includes('UTC') ? list : ['UTC', ...list];
};

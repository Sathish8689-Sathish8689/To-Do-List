export type Recurrence = 'daily' | 'weekly' | 'monthly';

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
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
    formatters.set(tz, f);
  }
  return f;
}

function localParts(ms: number, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year!, m: out.month!, d: out.day!, h: out.hour!, mi: out.minute!, s: out.second! };
}

function offsetMs(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

function localToUtc(p: Parts, tz: string): number {
  const guess = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  const first = guess - offsetMs(guess, tz);
  const second = guess - offsetMs(first, tz);
  return second;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Advances by whole local calendar units so the wall-clock time is preserved across DST changes.
export function nextOccurrence(dueIso: string, rule: Recurrence, tz: string): string {
  const base = Date.parse(dueIso);
  const p = localParts(base, tz);
  const next: Parts = { ...p };
  if (rule === 'monthly') {
    const total = p.y * 12 + (p.m - 1) + 1;
    next.y = Math.floor(total / 12);
    next.m = (total % 12) + 1;
    next.d = Math.min(p.d, daysInMonth(next.y, next.m));
  } else {
    const shifted = new Date(Date.UTC(p.y, p.m - 1, p.d + (rule === 'weekly' ? 7 : 1)));
    next.y = shifted.getUTCFullYear();
    next.m = shifted.getUTCMonth() + 1;
    next.d = shifted.getUTCDate();
  }
  return new Date(localToUtc(next, tz)).toISOString();
}

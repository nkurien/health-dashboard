/** Calendar-date helpers. Dates are "YYYY-MM-DD" strings in the user's timezone. */

/** Today's date in an IANA timezone (en-CA formats as YYYY-MM-DD). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every date from start to end inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface CivilDate { year: number; month: number; day: number }

export function civilToIso(d: CivilDate): string {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export function isoToCivil(iso: string): CivilDate {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y ?? 0, month: m ?? 0, day: d ?? 0 };
}

/** The local calendar date of a UTC timestamp, given Google's offset string like "3600s". */
export function localDateOf(timestamp: string, utcOffset: string | undefined): string {
  const seconds = Number.parseInt((utcOffset ?? "0s").replace(/s$/, ""), 10) || 0;
  return new Date(Date.parse(timestamp) + seconds * 1000).toISOString().slice(0, 10);
}

/** How far back the dashboard can be asked to look. */
export const MAX_LOOKBACK_DAYS = 365;

/** A requested dashboard date, or null if it isn't a real calendar date between a year ago and today. */
export function parseDashboardDate(raw: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return null; // e.g. 2026-02-31
  if (raw > today || raw < addDays(today, -MAX_LOOKBACK_DAYS)) return null;
  return raw;
}

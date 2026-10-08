import type { Person, ReadinessData, ReadinessLabel } from "./types";

export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function firstName(display: string | null, fallback: string): string {
  const first = display?.trim().split(/\s+/)[0];
  return first || fallback;
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Friendly wording for the recovery bands (no good/bad ranking between people). */
export const RECOVERY_WORDS: Record<ReadinessLabel, string> = {
  Optimal: "Fully recharged",
  Good: "Well recovered",
  Moderate: "Steady",
  Fair: "Taking it easy",
  Poor: "Needs rest",
  Unavailable: "Waiting for sync",
};

/** A short plain-English reason, from the signed point contributions. */
export function whyLines(c: ReadinessData["components"]): string[] {
  const out: string[] = [];
  if (c.hrv !== undefined) {
    out.push(c.hrv > 4 ? "HRV above usual" : c.hrv < -4 ? "HRV below usual" : "HRV about usual");
  }
  if (c.rhr !== undefined) {
    out.push(
      c.rhr > 1.8 ? "resting heart rate lower than usual"
      : c.rhr < -1.8 ? "resting heart rate higher than usual"
      : "resting heart rate about usual",
    );
  }
  if (c.sleep !== undefined) {
    out.push(c.sleep > 1.3 ? "well rested" : c.sleep < -1.3 ? "running low on sleep" : "sleep on track");
  }
  return out;
}

/** Minutes actually asleep (time in bed minus awake). */
export function asleepMinutes(p: Person): number | null {
  const s = p.metrics?.sleep;
  if (!s || s.total_minutes == null) return null;
  return s.total_minutes - s.stages.wake;
}

/** Last `days` calendar days ending at the newest entry, with nulls for days that have no data. */
export function fillDays<T extends { date: string }>(series: T[], days = 7): Array<T | { date: string }> {
  if (!series.length) return [];
  const byDate = new Map(series.map((d) => [d.date, d]));
  const end = new Date(`${series[series.length - 1].date}T12:00:00`);
  const out: Array<T | { date: string }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(byDate.get(iso) ?? { date: iso });
  }
  return out;
}

export function weekdayShort(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString([], { weekday: "short" });
}

export function summaryLines(people: Person[]): string[] {
  const lines: string[] = [];

  const rec = people.map((p) => {
    const r = p.metrics?.readiness;
    if (!r) return null;
    return r.score === null
      ? `${p.name}’s recovery will appear once their watch has synced`
      : `${p.name} is ${RECOVERY_WORDS[r.label].toLowerCase()} (${r.score})`;
  }).filter(Boolean);
  if (rec.length) lines.push(rec.join(" · "));

  const sleeps = people
    .map((p) => ({ p, m: asleepMinutes(p) }))
    .filter((x) => x.m !== null);
  if (sleeps.length) {
    lines.push(
      "Last night: " + sleeps.map((x) => `${x.p.name} slept ${fmtDuration(x.m)}`).join(", "),
    );
  }
  return lines;
}

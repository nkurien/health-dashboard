/**
 * Recovery score — fitted to Fitbit's own readiness scores (50 days, ~3.7 points
 * mean error on unseen days). Fitbit's number is driven almost entirely by how far
 * last night's HRV sits from the person's own normal, measured in units of their
 * own night-to-night variability (a z-score):
 *
 *   z     = (today's HRV - median HRV of the previous 30 days) / SD of those days
 *   score = 59 + 13.8 * z
 *
 * clamped to 0-100. HRV is required; without it there is no score (null), which
 * is normal in the morning until the watch has synced. Resting heart rate and
 * sleep hours were tested and add nothing measurable (see calibration/README.md),
 * so they do NOT change the score; they are still returned as components purely
 * so the dashboard can say "resting heart rate lower than usual" / "well rested".
 */
import type { ReadinessData, ReadinessLabel } from "./types";

const BASE = 59;
const K_HRV = 13.8; // points per SD of HRV above/below the person's normal
// Display-only scaling for the "why" lines (the old fitted weights; the frontend's thresholds assume them).
const K_RHR = 0.9;
const K_SLEEP = 1.3;
const SLEEP_REF_H = 6.5;
const SLEEP_CAP_H = 9;
const NIGHT_WEIGHTS = [0.5, 0.3, 0.2] as const; // most recent night first
const MIN_SD_FRACTION = 0.05; // floor the spread at 5% of the baseline so a freakishly steady month can't blow up z

export function weightedSleepHours(recentAsleepMin: ReadonlyArray<number | null | undefined>): number | null {
  let wSum = 0;
  let total = 0;
  NIGHT_WEIGHTS.forEach((w, i) => {
    const m = recentAsleepMin[i];
    if (m != null && m > 0) {
      wSum += w;
      total += w * m;
    }
  });
  if (wSum === 0) return null;
  return Math.min(total / wSum / 60, SLEEP_CAP_H);
}

export function labelFor(score: number): ReadinessLabel {
  if (score >= 85) return "Optimal";
  if (score >= 70) return "Good";
  if (score >= 55) return "Moderate";
  if (score >= 40) return "Fair";
  return "Poor";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeReadiness(input: {
  todayHrv: number | null;
  hrvBaseline: number | null;
  hrvSpread: number | null;
  todayRhr?: number | null;
  rhrBaseline?: number | null;
  recentAsleepMin?: ReadonlyArray<number | null | undefined>;
}): ReadinessData {
  const { todayHrv, hrvBaseline, hrvSpread, todayRhr, rhrBaseline, recentAsleepMin = [] } = input;
  if (todayHrv == null || !hrvBaseline || hrvBaseline <= 0 || !hrvSpread || hrvSpread < 0) {
    return { score: null, label: "Unavailable", components: {} };
  }

  const z = (todayHrv - hrvBaseline) / Math.max(hrvSpread, MIN_SD_FRACTION * hrvBaseline);
  const hrv = K_HRV * z;
  const score = Math.max(0, Math.min(100, Math.round(BASE + hrv)));

  // Context for the "why" lines only: not included in the score.
  const components: ReadinessData["components"] = { hrv: round1(hrv) };
  if (todayRhr != null && rhrBaseline && rhrBaseline > 0) components.rhr = round1(K_RHR * (rhrBaseline - todayRhr));
  const hours = weightedSleepHours(recentAsleepMin);
  if (hours != null) components.sleep = round1(K_SLEEP * (hours - SLEEP_REF_H));
  return { score, label: labelFor(score), components };
}

export function mean(values: ReadonlyArray<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
}

export function median(values: ReadonlyArray<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  const m = v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  return Math.round(m * 100) / 100;
}

/** Population standard deviation, or null when there are fewer than `minCount` values. */
export function stdev(values: ReadonlyArray<number | null | undefined>, minCount = 10): number | null {
  const v = values.filter((x): x is number => x != null);
  if (v.length < minCount) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

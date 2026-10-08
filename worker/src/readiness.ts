/**
 * Recovery score — fitted to Fitbit's own readiness scores (27 days, mean error
 * ~3.7 points). Fitbit's number is driven almost entirely by HRV relative to the
 * person's own normal:
 *
 *   score = 60
 *         + 84  * (HRV / 30-day median HRV - 1)
 *         + 0.9 * (30-day median RHR - today's RHR)           per bpm lower than usual
 *         + 1.3 * (weighted last-3-nights sleep hours - 6.5)
 *
 * clamped to 0-100. HRV is required; without it there is no score (null), which
 * is normal in the morning until the watch has synced. RHR and sleep are small
 * optional adjustments (weakly determined by the data).
 */
import type { ReadinessData, ReadinessLabel } from "./types";

const BASE = 60;
const K_HRV = 84;
const K_RHR = 0.9;
const K_SLEEP = 1.3;
const SLEEP_REF_H = 6.5;
const SLEEP_CAP_H = 9;
const NIGHT_WEIGHTS = [0.5, 0.3, 0.2] as const; // most recent night first

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
  todayRhr: number | null;
  rhrBaseline: number | null;
  recentAsleepMin: ReadonlyArray<number | null | undefined>;
}): ReadinessData {
  const { todayHrv, hrvBaseline, todayRhr, rhrBaseline, recentAsleepMin } = input;
  if (todayHrv == null || !hrvBaseline || hrvBaseline <= 0) {
    return { score: null, label: "Unavailable", components: {} };
  }

  const components: ReadinessData["components"] = { hrv: K_HRV * (todayHrv / hrvBaseline - 1) };
  if (todayRhr != null && rhrBaseline && rhrBaseline > 0) {
    components.rhr = K_RHR * (rhrBaseline - todayRhr);
  }
  const hours = weightedSleepHours(recentAsleepMin);
  if (hours != null) components.sleep = K_SLEEP * (hours - SLEEP_REF_H);

  const sum = Object.values(components).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.min(100, Math.round(BASE + sum)));
  return {
    score,
    label: labelFor(score),
    components: Object.fromEntries(
      Object.entries(components).map(([k, v]) => [k, round1(v)]),
    ) as ReadinessData["components"],
  };
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

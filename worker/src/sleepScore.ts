/**
 * Sleep score, 0-100, fitted to Fitbit's own sleep scores (63 nights, ~2.9 points
 * mean error on unseen nights by leave-one-out). Four things from last night's stages
 * explain it; resting HR, HRV, respiratory rate and non-REM heart rate added nothing
 * (see calibration/README.md).
 *
 *   score = -21.9 + 0.1257 * min(minutes asleep, 450)
 *                 + 27.3 * deep share + 31.1 * REM share   (of time asleep)
 *                 + 40.2 * efficiency                      (asleep / in bed)
 *
 * Sleeping past 7.5 h earns nothing more. Clamped to 0-100; no sleep recorded
 * means no score (null).
 */
import type { SleepStages } from "./types";

const DURATION_CAP_MIN = 450;

export function sleepScore(s: SleepStages): number | null {
  const asleep = s.deep + s.rem + s.light;
  if (asleep <= 0) return null;
  const raw =
    -21.9 + 0.1257 * Math.min(asleep, DURATION_CAP_MIN) +
    27.3 * (s.deep / asleep) + 31.1 * (s.rem / asleep) + 40.2 * (asleep / (asleep + s.wake));
  return Math.max(0, Math.min(100, Math.round(raw)));
}

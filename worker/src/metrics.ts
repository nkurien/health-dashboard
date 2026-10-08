import { addDays, dateRange } from "./dates";
import { HealthClient } from "./health";
import {
  mockHrvSeries, mockRhrSeries, mockSleepStages, mockSteps, stagesAsleep, stagesTotal,
} from "./mock";
import { computeReadiness, mean, median } from "./readiness";
import { RequestTokenSource, TokenStore } from "./tokens";
import type { MetricKey, SleepStages, UserId, UserMetrics } from "./types";

const CACHE_TTL_SECONDS = 15 * 60;
const BASELINE_DAYS = 30;

const cacheKey = (userId: UserId, date: string) => new Request(`https://cache.internal/metrics/${userId}/${date}`);

export async function invalidateMetrics(userId: UserId, date: string): Promise<void> {
  await caches.default.delete(cacheKey(userId, date));
}

const ZERO_STAGES = (): SleepStages => ({ deep: 0, rem: 0, light: 0, wake: 0 });

/** Everything the dashboard shows for one person on one day. */
export async function buildUserMetrics(env: Env, userId: UserId, date: string): Promise<UserMetrics> {
  const key = cacheKey(userId, date);
  const hit = await caches.default.match(key);
  if (hit) return { ...((await hit.json()) as UserMetrics), from_cache: true };

  const weekStart = addDays(date, -6);
  const baselineStart = addDays(date, -(BASELINE_DAYS - 1));
  const tokens = new RequestTokenSource(new TokenStore(env.DB, env.APP_SECRET), userId, env);
  const client = new HealthClient(tokens);

  // Four Google calls, in parallel. A failure in one doesn't take down the others.
  const [stepsR, sleepR, rhrR, hrvR] = await Promise.allSettled([
    client.stepsSeries(weekStart, date),
    client.sleepNights(weekStart, date),
    client.rhrSeries(baselineStart, date),
    client.hrvSeries(baselineStart, date),
  ]);

  const errors: UserMetrics["errors"] = {};
  const value = <T>(name: MetricKey, r: PromiseSettledResult<T | null>): T | null | undefined => {
    if (r.status === "fulfilled") return r.value; // null => not connected => demo data
    errors[name] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    console.error(JSON.stringify({ msg: "metric failed", userId, metric: name, error: errors[name] }));
    return undefined; // undefined => failed
  };

  const isMock = !(await tokens.hasAccount());
  const week = dateRange(weekStart, date);

  // Steps
  const stepsV = value("steps", stepsR);
  const stepsSeries = stepsV === undefined ? [] : stepsV ?? week.map((d) => ({ date: d, steps: mockSteps(userId, d) }));
  const todaySteps = stepsV === undefined ? null : stepsSeries.find((p) => p.date === date)?.steps ?? 0;

  // Sleep
  const sleepV = value("sleep", sleepR);
  const nights: Record<string, SleepStages> =
    sleepV === undefined ? {} : sleepV ?? Object.fromEntries(week.map((d) => [d, mockSleepStages(userId, d)]));
  const lastNight = nights[date] ?? ZERO_STAGES();
  const total = stagesTotal(lastNight);
  const sleepSeries = Object.entries(nights)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, s]) => ({ date: d, asleep_minutes: Math.round(stagesAsleep(s)) }));

  // Heart
  const rhr30 = value("rhr", rhrR) ?? (rhrR.status === "rejected" ? [] : mockRhrSeries(userId, baselineStart, date));
  const hrv30 = value("hrv", hrvR) ?? (hrvR.status === "rejected" ? [] : mockHrvSeries(userId, baselineStart, date));
  const rhrWeek = rhr30.filter((p) => p.date >= weekStart);
  const hrvWeek = hrv30.filter((p) => p.date >= weekStart);
  const priorRhr = rhrWeek.filter((p) => p.date !== date).map((p) => p.rhr);
  const priorHrv = hrvWeek.filter((p) => p.date !== date).map((p) => p.rmssd);
  const todayRhr = rhr30.find((p) => p.date === date)?.rhr ?? null;
  const todayHrv = hrv30.find((p) => p.date === date)?.rmssd ?? null;

  const readiness = computeReadiness({
    todayHrv,
    hrvBaseline: median(hrv30.filter((p) => p.date !== date).map((p) => p.rmssd)),
    todayRhr,
    rhrBaseline: median(rhr30.filter((p) => p.date !== date).map((p) => p.rhr)),
    recentAsleepMin: [0, 1, 2].map((i) => {
      const night = nights[addDays(date, -i)];
      return night ? stagesAsleep(night) : null;
    }),
  });

  const metrics: UserMetrics = {
    user_id: userId,
    date,
    is_mock: isMock,
    from_cache: false,
    errors,
    steps: {
      steps: todaySteps,
      goal: Number(env.STEP_GOAL) || 10000,
      series: stepsSeries,
      is_mock: isMock,
    },
    sleep: {
      total_minutes: errors.sleep ? null : total,
      efficiency_pct: errors.sleep ? null : total > 0 ? Math.round((stagesAsleep(lastNight) / total) * 1000) / 10 : 0,
      stages: lastNight,
      series: sleepSeries,
      is_mock: isMock,
    },
    heart: {
      rhr_today: todayRhr,
      rhr_7d_avg: mean(priorRhr) ?? mean(rhrWeek.map((p) => p.rhr)),
      rhr_series: rhrWeek,
      hrv_today: todayHrv,
      hrv_7d_avg: mean(priorHrv) ?? mean(hrvWeek.map((p) => p.rmssd)),
      hrv_series: hrvWeek,
    },
    readiness,
  };

  if (Object.keys(errors).length === 0) {
    // Don't pin a transient failure in the cache for 15 minutes
    await caches.default.put(
      key,
      new Response(JSON.stringify(metrics), {
        headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL_SECONDS}` },
      }),
    );
  }
  return metrics;
}

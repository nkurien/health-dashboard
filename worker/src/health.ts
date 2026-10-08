/**
 * Google Health API v4 client (https://health.googleapis.com/v4/users/me/dataTypes).
 * Request/response shapes here were verified against a real account.
 *
 * Every method returns null when the user hasn't connected Google (callers fall
 * back to demo data) and throws HealthAPIError when a connected user's request fails.
 */
import { addDays, civilToIso, isoToCivil, localDateOf, type CivilDate } from "./dates";
import type { TokenSource } from "./tokens";
import type { SleepStages } from "./types";

const BASE = "https://health.googleapis.com/v4/users/me/dataTypes";

export class HealthAPIError extends Error {
  override name = "HealthAPIError";
}

type Json = Record<string, unknown>;

export class HealthClient {
  constructor(
    private tokens: TokenSource,
    // Wrapped, not `= fetch`: calling the global as `this.fetchFn(...)` gives it the wrong
    // `this`, and Workers throws "Illegal invocation".
    private fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async request(
    method: "GET" | "POST",
    dataType: string,
    suffix: string,
    opts: { params?: Record<string, string | number>; body?: unknown } = {},
  ): Promise<Json | null> {
    let token = await this.tokens.get();
    if (!token) {
      if (await this.tokens.hasAccount()) {
        throw new HealthAPIError("Google sign-in expired or was revoked. Reconnect this account.");
      }
      return null;
    }

    const url = new URL(`${BASE}/${dataType}/${suffix}`);
    for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, String(v));

    const send = (t: string) =>
      this.fetchFn(url, {
        method,
        headers: { Authorization: `Bearer ${t}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });

    try {
      let resp = await send(token);
      if (resp.status === 401) {
        const fresh = await this.tokens.refresh(token);
        if (fresh) {
          token = fresh;
          resp = await send(fresh);
        }
      }
      if (!resp.ok) {
        throw new HealthAPIError(`${dataType}: HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}`);
      }
      return (await resp.json()) as Json;
    } catch (err) {
      if (err instanceof HealthAPIError) throw err;
      throw new HealthAPIError(`${dataType}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Daily step totals for [start, end], oldest first. */
  async stepsSeries(start: string, end: string): Promise<Array<{ date: string; steps: number }> | null> {
    const next = isoToCivil(addDays(end, 1));
    const data = await this.request("POST", "steps", "dataPoints:dailyRollUp", {
      body: { range: { start: { date: isoToCivil(start) }, end: { date: next } }, windowSizeDays: 1 },
    });
    if (!data) return null;
    const points = (data.rollupDataPoints as Json[] | undefined) ?? [];
    return points
      .map((p) => ({
        date: civilToIso(((p.civilStartTime as Json).date as CivilDate)),
        steps: Number(((p.steps as Json | undefined)?.countSum as string | undefined) ?? 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Sleep per night, keyed by the local date the night ENDED (wake-up day).
   * Naps and split sessions on the same day are summed.
   */
  async sleepNights(start: string, end: string): Promise<Record<string, SleepStages> | null> {
    const data = await this.request("GET", "sleep", "dataPoints", {
      params: {
        filter: `sleep.interval.civil_end_time >= "${start}" AND sleep.interval.civil_end_time < "${addDays(end, 1)}"`,
        pageSize: 25,
      },
    });
    if (!data) return null;

    const kind: Record<string, keyof SleepStages> = {
      DEEP: "deep", REM: "rem", LIGHT: "light", ASLEEP: "light", AWAKE: "wake", RESTLESS: "wake",
    };
    const nights: Record<string, SleepStages> = {};
    for (const dp of (data.dataPoints as Json[] | undefined) ?? []) {
      const sleep = dp.sleep as Json | undefined;
      const interval = sleep?.interval as Json | undefined;
      if (!interval?.endTime) continue;
      const day = localDateOf(String(interval.endTime), interval.endUtcOffset as string | undefined);
      const night = (nights[day] ??= { deep: 0, rem: 0, light: 0, wake: 0 });
      for (const st of (sleep?.stages as Json[] | undefined) ?? []) {
        const key = kind[String(st.type)];
        const ms = Date.parse(String(st.endTime)) - Date.parse(String(st.startTime));
        if (key && Number.isFinite(ms)) night[key] += Math.floor(ms / 60_000);
      }
    }
    return nights;
  }

  private async dailyList(dataType: string, field: string, start: string, end: string): Promise<Json[] | null> {
    const data = await this.request("GET", dataType, "dataPoints", {
      params: { filter: `${field}.date >= "${start}" AND ${field}.date < "${addDays(end, 1)}"`, pageSize: 31 },
    });
    return data ? ((data.dataPoints as Json[] | undefined) ?? []) : null;
  }

  async rhrSeries(start: string, end: string): Promise<Array<{ date: string; rhr: number }> | null> {
    const pts = await this.dailyList("daily-resting-heart-rate", "daily_resting_heart_rate", start, end);
    if (!pts) return null;
    return pts
      .flatMap((p) => {
        const d = p.dailyRestingHeartRate as Json | undefined;
        return d?.beatsPerMinute != null ? [{ date: civilToIso(d.date as CivilDate), rhr: Number(d.beatsPerMinute) }] : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Daily average HRV in ms (reported under the key `rmssd` for the frontend). */
  async hrvSeries(start: string, end: string): Promise<Array<{ date: string; rmssd: number }> | null> {
    const pts = await this.dailyList("daily-heart-rate-variability", "daily_heart_rate_variability", start, end);
    if (!pts) return null;
    return pts
      .flatMap((p) => {
        const d = p.dailyHeartRateVariability as Json | undefined;
        const v = d?.averageHeartRateVariabilityMilliseconds;
        return v != null ? [{ date: civilToIso(d!.date as CivilDate), rmssd: Math.round(Number(v) * 10) / 10 }] : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

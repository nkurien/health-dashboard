import { describe, expect, it, vi } from "vitest";
import { HealthAPIError, HealthClient } from "../src/health";
import type { TokenSource } from "../src/tokens";

/** Response shapes captured from the real Google Health API. */
const SLEEP = {
  dataPoints: [
    {
      sleep: {
        interval: { startTime: "2026-10-08T00:25:00Z", endTime: "2026-10-08T08:18:00Z", endUtcOffset: "3600s" },
        stages: [
          { startTime: "2026-10-08T00:25:00Z", endTime: "2026-10-08T00:35:00Z", type: "AWAKE" },
          { startTime: "2026-10-08T00:35:00Z", endTime: "2026-10-08T00:45:00Z", type: "LIGHT" },
          { startTime: "2026-10-08T00:45:00Z", endTime: "2026-10-08T01:31:00Z", type: "DEEP" },
          { startTime: "2026-10-08T01:35:00Z", endTime: "2026-10-08T01:44:00Z", type: "REM" },
        ],
      },
    },
  ],
};
const RHR = {
  dataPoints: [
    { dailyRestingHeartRate: { date: { year: 2026, month: 10, day: 8 }, beatsPerMinute: "75" } },
    { dailyRestingHeartRate: { date: { year: 2026, month: 10, day: 7 }, beatsPerMinute: "76" } },
  ],
};
const HRV = {
  dataPoints: [
    { dailyHeartRateVariability: { date: { year: 2026, month: 10, day: 8 }, averageHeartRateVariabilityMilliseconds: 36.25 } },
    { dailyHeartRateVariability: { date: { year: 2026, month: 10, day: 7 }, nonRemHeartRateBeatsPerMinute: "64" } }, // no HRV value
  ],
};
const ROLLUP = {
  rollupDataPoints: [
    { civilStartTime: { date: { year: 2026, month: 10, day: 8 } }, steps: { countSum: "9217" } },
    { civilStartTime: { date: { year: 2026, month: 10, day: 7 } }, steps: { countSum: "6481" } },
  ],
};

const tokens = (over: Partial<TokenSource> = {}): TokenSource => ({
  get: async () => "tok",
  refresh: async () => null,
  hasAccount: async () => true,
  ...over,
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("HealthClient parsing", () => {
  it("sleepNights: stages per wake-up day, in minutes", async () => {
    const c = new HealthClient(tokens(), (async () => ok(SLEEP)) as typeof fetch);
    expect(await c.sleepNights("2026-10-02", "2026-10-08")).toEqual({
      "2026-10-08": { wake: 10, light: 10, deep: 46, rem: 9 },
    });
  });
  it("rhrSeries / hrvSeries: numbers, sorted oldest first, skips points without a value", async () => {
    expect(await new HealthClient(tokens(), (async () => ok(RHR)) as typeof fetch).rhrSeries("2026-10-01", "2026-10-08")).toEqual([
      { date: "2026-10-07", rhr: 76 }, { date: "2026-10-08", rhr: 75 },
    ]);
    expect(await new HealthClient(tokens(), (async () => ok(HRV)) as typeof fetch).hrvSeries("2026-10-01", "2026-10-08")).toEqual([
      { date: "2026-10-08", rmssd: 36.3 },
    ]);
  });
  it("stepsSeries: posts a rollup range ending the day after `end`", async () => {
    const fetchFn = vi.fn(async () => ok(ROLLUP));
    const c = new HealthClient(tokens(), fetchFn as unknown as typeof fetch);
    expect(await c.stepsSeries("2026-10-07", "2026-10-08")).toEqual([
      { date: "2026-10-07", steps: 6481 }, { date: "2026-10-08", steps: 9217 },
    ]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain("/steps/dataPoints:dailyRollUp");
    expect(JSON.parse(String(init.body)).range.end.date).toEqual({ year: 2026, month: 10, day: 9 });
  });
  it("sends the documented date filter", async () => {
    const fetchFn = vi.fn(async () => ok({ dataPoints: [] }));
    await new HealthClient(tokens(), fetchFn as unknown as typeof fetch).rhrSeries("2026-10-01", "2026-10-08");
    const [url] = fetchFn.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.get("filter")).toBe('daily_resting_heart_rate.date >= "2026-10-01" AND daily_resting_heart_rate.date < "2026-10-09"');
  });
});

describe("HealthClient default fetch", () => {
  it("calls the global fetch with a valid `this` (Workers throws 'Illegal invocation' otherwise)", async () => {
    vi.stubGlobal("fetch", function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(ok(RHR));
    });
    try {
      expect(await new HealthClient(tokens()).rhrSeries("2026-10-01", "2026-10-08")).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("HealthClient auth handling", () => {
  it("returns null (demo mode) when the user never connected", async () => {
    const c = new HealthClient(tokens({ get: async () => null, hasAccount: async () => false }));
    expect(await c.rhrSeries("2026-10-01", "2026-10-08")).toBeNull();
  });
  it("throws when connected but the token is gone", async () => {
    const c = new HealthClient(tokens({ get: async () => null, hasAccount: async () => true }));
    await expect(c.rhrSeries("2026-10-01", "2026-10-08")).rejects.toThrow(HealthAPIError);
  });
  it("refreshes once on 401 and retries", async () => {
    const seen: string[] = [];
    const fetchFn = (async (_u: unknown, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization!;
      seen.push(auth);
      return auth === "Bearer fresh" ? ok(RHR) : new Response("no", { status: 401 });
    }) as typeof fetch;
    const c = new HealthClient(tokens({ refresh: async () => "fresh" }), fetchFn);
    expect(await c.rhrSeries("2026-10-01", "2026-10-08")).toHaveLength(2);
    expect(seen).toEqual(["Bearer tok", "Bearer fresh"]);
  });
  it("surfaces HTTP errors with status and body", async () => {
    const c = new HealthClient(tokens(), (async () => new Response('{"error":"bad"}', { status: 400 })) as typeof fetch);
    await expect(c.rhrSeries("2026-10-01", "2026-10-08")).rejects.toThrow(/HTTP 400.*bad/);
  });
  it("wraps network failures", async () => {
    const c = new HealthClient(tokens(), (async () => { throw new Error("boom"); }) as typeof fetch);
    await expect(c.rhrSeries("2026-10-01", "2026-10-08")).rejects.toThrow(/boom/);
  });
});

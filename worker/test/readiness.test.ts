import { describe, expect, it } from "vitest";
import { computeReadiness, labelFor, mean, median, weightedSleepHours } from "../src/readiness";

const SLEEP_OK = [390, 390, 390]; // 6.5 h: the neutral reference

const score = (o: Partial<Parameters<typeof computeReadiness>[0]> = {}) =>
  computeReadiness({ todayHrv: 36, hrvBaseline: 36, todayRhr: 76, rhrBaseline: 76, recentAsleepMin: SLEEP_OK, ...o }).score;

describe("computeReadiness", () => {
  it("neutral day is the base score", () => expect(score()).toBe(60));
  it("HRV dominates", () => {
    expect(score({ todayHrv: 45 })!).toBeGreaterThan(80);
    expect(score({ todayHrv: 27 })!).toBeLessThan(40);
  });
  it("lower RHR and more sleep help modestly", () => {
    expect(score({ todayRhr: 72 })!).toBeGreaterThan(score()!);
    expect(score({ recentAsleepMin: [540, 540, 540] })!).toBeGreaterThan(score()!);
    expect(score({ todayRhr: 72 })! - score()!).toBeLessThan(6);
  });
  it("no HRV means no score", () => {
    const r = computeReadiness({ todayHrv: null, hrvBaseline: 36, todayRhr: 76, rhrBaseline: 76, recentAsleepMin: SLEEP_OK });
    expect(r).toEqual({ score: null, label: "Unavailable", components: {} });
    expect(score({ hrvBaseline: null })).toBeNull();
  });
  it("RHR and sleep are optional", () => {
    const r = computeReadiness({ todayHrv: 36, hrvBaseline: 36, todayRhr: null, rhrBaseline: null, recentAsleepMin: [null, null, null] });
    expect(r.score).toBe(60);
    expect(Object.keys(r.components)).toEqual(["hrv"]);
  });
  it("clamps to 0-100", () => {
    expect(score({ todayHrv: 500 })).toBe(100);
    expect(score({ todayHrv: 1 })).toBe(0);
  });
  it("components are signed contributions", () => {
    const r = computeReadiness({ todayHrv: 40, hrvBaseline: 36, todayRhr: 78, rhrBaseline: 76, recentAsleepMin: SLEEP_OK });
    expect(r.components.hrv!).toBeGreaterThan(0);
    expect(r.components.rhr!).toBeLessThan(0);
  });
});

describe("matches the Python implementation it replaced", () => {
  // Fitbit-recorded days used to fit the model: [fitbit, hrv, hrvBase, rhr, rhrBase, nights]
  const days: Array<[number, number, number, number, number, Array<number | null>]> = [
    [66, 36.2, 35.8, 75, 75, [462, 342, 444]],
    [53, 34.0, 36.2, 76, 75, [342, 444, 288]],
    [31, 27.8, 36.2, 78, 75, [258, null, 336]],
  ];
  it.each(days)("fitbit %i is within 12 points", (fitbit, hrv, hrvBase, rhr, rhrBase, nights) => {
    const s = score({ todayHrv: hrv, hrvBaseline: hrvBase, todayRhr: rhr, rhrBaseline: rhrBase, recentAsleepMin: nights })!;
    expect(Math.abs(s - fitbit)).toBeLessThanOrEqual(12);
  });
});

describe("sleep weighting", () => {
  it("missing nights use the remaining weights", () => expect(weightedSleepHours([480, null, null])).toBe(8));
  it("nothing -> null", () => expect(weightedSleepHours([null, null, null])).toBeNull());
  it("caps at 9h", () => expect(weightedSleepHours([900, 900, 900])).toBe(9));
});

describe("labels and stats", () => {
  it("label boundaries", () =>
    expect([100, 85, 84, 70, 69, 55, 54, 40, 39, 0].map(labelFor)).toEqual([
      "Optimal", "Optimal", "Good", "Good", "Moderate", "Moderate", "Fair", "Fair", "Poor", "Poor",
    ]));
  it("mean and median", () => {
    expect(mean([10, 20, null])).toBe(15);
    expect(mean([])).toBeNull();
    expect(median([1, 2, 100])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

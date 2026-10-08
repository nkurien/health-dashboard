import { describe, expect, it } from "vitest";
import { computeReadiness, labelFor, mean, median, stdev, weightedSleepHours } from "../src/readiness";

const score = (o: Partial<Parameters<typeof computeReadiness>[0]> = {}) =>
  computeReadiness({ todayHrv: 36, hrvBaseline: 36, hrvSpread: 4.5, ...o }).score;

describe("computeReadiness", () => {
  it("a day at your normal HRV is the base score", () => expect(score()).toBe(59));
  it("is measured in your own standard deviations", () => {
    expect(score({ todayHrv: 40.5 })).toBe(73); // +1 SD
    expect(score({ todayHrv: 31.5 })).toBe(45); // -1 SD
    // the same raw HRV means less for someone whose HRV swings more
    expect(score({ todayHrv: 40.5, hrvSpread: 9 })!).toBeLessThan(score({ todayHrv: 40.5 })!);
  });
  it("no HRV, baseline or spread means no score", () => {
    const none = { score: null, label: "Unavailable", components: {} };
    expect(computeReadiness({ todayHrv: null, hrvBaseline: 36, hrvSpread: 4.5 })).toEqual(none);
    expect(score({ hrvBaseline: null })).toBeNull();
    expect(score({ hrvSpread: null })).toBeNull();
  });
  it("floors the spread so a freakishly steady month can't blow up the score", () => {
    expect(score({ todayHrv: 37, hrvSpread: 0.01 })).toBe(score({ todayHrv: 37, hrvSpread: 1.8 }));
  });
  it("clamps to 0-100", () => {
    expect(score({ todayHrv: 500 })).toBe(100);
    expect(score({ todayHrv: 1 })).toBe(0);
  });
  it("the HRV component is the signed contribution", () => {
    expect(computeReadiness({ todayHrv: 40.5, hrvBaseline: 36, hrvSpread: 4.5 }).components).toEqual({ hrv: 13.8 });
    expect(computeReadiness({ todayHrv: 31.5, hrvBaseline: 36, hrvSpread: 4.5 }).components).toEqual({ hrv: -13.8 });
  });
});

describe("resting heart rate and sleep are display-only", () => {
  const extra = { todayRhr: 70, rhrBaseline: 76, recentAsleepMin: [540, 540, 540] };
  it("do not change the score", () => expect(score(extra)).toBe(score()));
  it("still appear as signed components for the why lines", () => {
    const r = computeReadiness({ todayHrv: 36, hrvBaseline: 36, hrvSpread: 4.5, ...extra });
    expect(r.components.rhr!).toBeGreaterThan(0); // lower than usual
    expect(r.components.sleep!).toBeGreaterThan(0); // 9 h vs 6.5 h reference
    expect(computeReadiness({ todayHrv: 36, hrvBaseline: 36, hrvSpread: 4.5, todayRhr: 80, rhrBaseline: 76 }).components.rhr!).toBeLessThan(0);
  });
  it("are omitted when there is no data", () =>
    expect(Object.keys(computeReadiness({ todayHrv: 36, hrvBaseline: 36, hrvSpread: 4.5 }).components)).toEqual(["hrv"]));
});

describe("sleep weighting", () => {
  it("missing nights use the remaining weights", () => expect(weightedSleepHours([480, null, null])).toBe(8));
  it("nothing -> null", () => expect(weightedSleepHours([null, null, null])).toBeNull());
  it("caps at 9h", () => expect(weightedSleepHours([900, 900, 900])).toBe(9));
});

describe("tracks real Fitbit readiness days", () => {
  // [fitbit, hrv, 30-day median, 30-day SD] from user1's labelled days
  const days: Array<[number, number, number, number]> = [
    [66, 36.25, 35.8, 4.5],
    [53, 34.0, 36.2, 4.72],
    [31, 27.75, 36.25, 5.3],
    [90, 45.4, 35.0, 5.46],
    [21, 24.4, 36.75, 5.55],
  ];
  it.each(days)("fitbit %i is within 8 points", (fitbit, hrv, base, sd) => {
    expect(Math.abs(score({ todayHrv: hrv, hrvBaseline: base, hrvSpread: sd })! - fitbit)).toBeLessThanOrEqual(8);
  });
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
  it("stdev needs enough values", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9], 5)).toBe(2);
    expect(stdev([1, 2, 3])).toBeNull();
    expect(stdev([2, 4, null, 4, 4, 5, 5, 7, 9], 5)).toBe(2);
  });
});

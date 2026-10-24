import { describe, expect, it } from "vitest";
import { sleepScore } from "../src/sleepScore";

const night = (o: Partial<Record<"deep" | "rem" | "light" | "wake", number>> = {}) =>
  ({ deep: 80, rem: 100, light: 230, wake: 30, ...o });

describe("sleepScore", () => {
  it("a typical good night lands in the 70s-80s", () => {
    expect(sleepScore(night())).toBeGreaterThanOrEqual(70);
    expect(sleepScore(night())).toBeLessThanOrEqual(90);
  });
  it("no sleep means no score", () => expect(sleepScore({ deep: 0, rem: 0, light: 0, wake: 30 })).toBeNull());
  it("longer sleep, more REM and less waking all score higher", () => {
    expect(sleepScore(night({ light: 330 }))!).toBeGreaterThan(sleepScore(night({ light: 130 }))!);
    expect(sleepScore(night({ rem: 140, light: 190 }))!).toBeGreaterThan(sleepScore(night())!);
    expect(sleepScore(night({ wake: 120 }))!).toBeLessThan(sleepScore(night())!);
  });
  it("sleeping past 7.5 h earns nothing more", () => {
    const scaled = (k: number) => sleepScore({ deep: 80 * k, rem: 100 * k, light: 230 * k, wake: 30 * k });
    expect(scaled(1.3)).toBe(scaled(1.8)); // both well past 450 min, same stage shares
  });
  it("clamps to 0-100", () => {
    expect(sleepScore({ deep: 1, rem: 1, light: 1, wake: 600 })!).toBeGreaterThanOrEqual(0);
    expect(sleepScore({ deep: 200, rem: 300, light: 300, wake: 0 })!).toBeLessThanOrEqual(100);
  });
});

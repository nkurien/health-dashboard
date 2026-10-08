import { describe, expect, it } from "vitest";
import { addDays, dateRange, localDateOf, todayIn } from "../src/dates";
import { mockHrvSeries, mockRhrSeries, mockSleepStages, mockSteps, stagesAsleep } from "../src/mock";

describe("dates", () => {
  it("todayIn respects the timezone", () => {
    const t = new Date("2026-10-08T23:30:00Z");
    expect(todayIn("Europe/London", t)).toBe("2026-10-09"); // BST: 00:30 next day
    expect(todayIn("America/New_York", t)).toBe("2026-10-08");
  });
  it("addDays crosses months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("dateRange is inclusive", () => expect(dateRange("2026-10-06", "2026-10-08")).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]));
  it("localDateOf applies Google's UTC offset", () => {
    expect(localDateOf("2026-10-08T23:30:00Z", "3600s")).toBe("2026-10-09");
    expect(localDateOf("2026-10-08T08:18:00Z", "3600s")).toBe("2026-10-08");
    expect(localDateOf("2026-10-08T08:18:00Z", undefined)).toBe("2026-10-08");
  });
});

describe("demo data", () => {
  it("is deterministic per user and date", () => {
    expect(mockSteps("user1", "2026-10-08")).toBe(mockSteps("user1", "2026-10-08"));
    expect(mockSleepStages("user2", "2026-10-08")).toEqual(mockSleepStages("user2", "2026-10-08"));
    expect(mockSteps("user1", "2026-10-08")).not.toBe(mockSteps("user2", "2026-10-08"));
  });
  it("stays in realistic ranges", () => {
    for (const d of dateRange("2026-09-01", "2026-09-30")) {
      const steps = mockSteps("user1", d);
      expect(steps).toBeGreaterThanOrEqual(5000);
      expect(steps).toBeLessThanOrEqual(14000);
      expect(stagesAsleep(mockSleepStages("user1", d))).toBeGreaterThan(200);
    }
    for (const p of mockHrvSeries("user1", "2026-09-01", "2026-09-30")) expect(p.rmssd).toBeGreaterThanOrEqual(12);
    expect(mockRhrSeries("user2", "2026-09-01", "2026-09-07")).toHaveLength(7);
  });
});

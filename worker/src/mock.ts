/**
 * Deterministic demo data for users who haven't connected Google yet.
 * Seeded per user + date, so the numbers are stable across requests and restarts.
 */
import { addDays, dateRange } from "./dates";
import type { SleepStages } from "./types";

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

class Rng {
  private state: number;
  constructor(seedText: string) {
    this.state = fnv1a(seedText);
  }
  /** mulberry32 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

export function mockSteps(userId: string, date: string): number {
  return new Rng(`${userId}${date}`).int(5000, 14000);
}

export function mockSleepStages(userId: string, date: string): SleepStages {
  const rng = new Rng(`${userId}${date}sleep`);
  const total = rng.int(360, 510);
  const wake = rng.int(15, 45);
  const deep = rng.int(55, 100);
  const rem = rng.int(80, 130);
  return { deep, rem, light: Math.max(0, total - wake - deep - rem), wake };
}

export const stagesTotal = (s: SleepStages) => s.deep + s.rem + s.light + s.wake;
export const stagesAsleep = (s: SleepStages) => s.deep + s.rem + s.light;

export function mockRhrSeries(userId: string, start: string, end: string): Array<{ date: string; rhr: number }> {
  const base = new Rng(`${userId}rhr_base`).uniform(52, 70);
  return dateRange(start, end).map((date) => ({
    date,
    rhr: Math.round((base + new Rng(`${userId}${date}rhr`).uniform(-4, 4)) * 10) / 10,
  }));
}

export function mockHrvSeries(userId: string, start: string, end: string): Array<{ date: string; rmssd: number }> {
  const base = new Rng(`${userId}hrv_base`).uniform(28, 62);
  return dateRange(start, end).map((date) => ({
    date,
    rmssd: Math.round(Math.max(12, base + new Rng(`${userId}${date}hrv`).uniform(-6, 6)) * 10) / 10,
  }));
}

export { addDays };

// Response shapes — must stay in sync with ../../frontend/lib/types.ts

export interface SleepStages { deep: number; rem: number; light: number; wake: number }

export interface SleepData {
  total_minutes: number | null;
  efficiency_pct: number | null;
  stages: SleepStages;
  series: Array<{ date: string; asleep_minutes: number }>;
  is_mock: boolean;
}

export interface StepsData {
  steps: number | null;
  goal: number;
  series: Array<{ date: string; steps: number }>;
  is_mock: boolean;
}

export interface HeartData {
  rhr_today: number | null;
  rhr_7d_avg: number | null;
  rhr_series: Array<{ date: string; rhr: number }>;
  hrv_today: number | null;
  hrv_7d_avg: number | null;
  hrv_series: Array<{ date: string; rmssd: number }>;
}

export type ReadinessLabel = "Optimal" | "Good" | "Moderate" | "Fair" | "Poor" | "Unavailable";

export interface ReadinessData {
  score: number | null;
  label: ReadinessLabel;
  components: Partial<Record<"hrv" | "rhr" | "sleep", number>>;
}

export type MetricKey = "steps" | "sleep" | "rhr" | "hrv";

export interface UserMetrics {
  user_id: UserId;
  date: string;
  is_mock: boolean;
  from_cache: boolean;
  errors: Partial<Record<MetricKey, string>>;
  steps: StepsData;
  sleep: SleepData;
  heart: HeartData;
  readiness: ReadinessData;
}

export type UserId = "user1" | "user2";
export const USER_IDS: readonly UserId[] = ["user1", "user2"];
export function isUserId(v: string): v is UserId {
  return v === "user1" || v === "user2";
}

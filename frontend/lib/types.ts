// ─────────────────────────────────────────────
// Shared TypeScript interfaces for the health
// dashboard — kept in sync with backend JSON.
// ─────────────────────────────────────────────

export type UserId = "user1" | "user2";

export interface SleepStages {
  deep: number;   // minutes
  rem: number;
  light: number;
  wake: number;
}

export interface SleepData {
  total_minutes: number | null;   // time in bed; null if the request failed
  efficiency_pct: number | null;
  stages: SleepStages;
  /** Minutes actually asleep per night, by wake-up date, oldest first. */
  series?: Array<{ date: string; asleep_minutes: number }>;
  is_mock: boolean;
}

export interface StepsData {
  steps: number | null;           // null if the request failed
  goal: number;
  series?: Array<{ date: string; steps: number }>;
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

export type ReadinessLabel =
  | "Optimal" | "Good" | "Moderate" | "Fair" | "Poor" | "Unavailable";

export interface ReadinessData {
  score: number | null;   // 0–100; null until today's HRV has synced
  label: ReadinessLabel;
  /** Signed points each signal adds to / takes from the neutral base of 60. */
  components: Partial<Record<"hrv" | "rhr" | "sleep", number>>;
}

export interface UserMetrics {
  user_id: string;
  date: string;
  is_mock: boolean;
  from_cache: boolean;
  errors: Partial<Record<"steps" | "sleep" | "rhr" | "hrv" | "sleep_history" | "steps_history", string>>;
  steps: StepsData;
  sleep: SleepData;
  heart: HeartData;
  readiness: ReadinessData;
}

export interface DashboardResponse {
  date: string;
  user1: UserMetrics;
  user2: UserMetrics;
}

export interface AuthStatus {
  user1: { connected: boolean; display_name: string | null; email: string | null };
  user2: { connected: boolean; display_name: string | null; email: string | null };
}

/** A person on the dashboard: identity + their metrics. */
export interface Person {
  id: UserId;
  name: string;
  connected: boolean;
  metrics: UserMetrics | null;
}

import type { DashboardResponse, AuthStatus } from "./types";

// Deployed: the Worker serves both the page and the API, so same-origin ("").
// `next dev`: talk to the Worker running locally (`npm run dev` in ../worker).
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "development" ? "http://localhost:8787" : "");

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    // Session ended: go sign in again (the Worker brings us back here afterwards)
    window.location.href = `${API_URL}/auth/signin`;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Fetch combined metrics for both users. */
export async function fetchDashboard(): Promise<DashboardResponse> {
  return apiFetch<DashboardResponse>("/api/dashboard");
}

/** Fetch OAuth connection status for both users. */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  return apiFetch<AuthStatus>("/auth/status");
}

/** Force-refresh cached metrics for one user. */
export async function refreshUserMetrics(userId: "user1" | "user2"): Promise<void> {
  await apiFetch(`/api/refresh/${userId}`, { method: "POST" });
}

/** Disconnect (delete stored tokens) for one user. */
export async function disconnectUser(userId: "user1" | "user2"): Promise<void> {
  await apiFetch(`/auth/disconnect/${userId}`, { method: "POST" });
}

/** URL that initiates the Google OAuth flow for a user. */
export function loginUrl(userId: "user1" | "user2"): string {
  return `${API_URL}/auth/login/${userId}`;
}

/** Sign out of this browser. */
export const signoutUrl = `${API_URL}/auth/signout`;

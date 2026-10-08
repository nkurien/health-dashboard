"use client";

import { useEffect, useState, useCallback } from "react";
import type { DashboardResponse, AuthStatus, Person } from "@/lib/types";
import { fetchDashboard, fetchAuthStatus } from "@/lib/api";
import { firstName } from "@/lib/format";
import Header from "@/components/Header";
import PeopleStrip from "@/components/PeopleStrip";
import { HeartRow, RecoveryRow, SleepRow, StepsRow } from "@/components/MetricRows";

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // No state is set before the first await, so this is safe to call from effects.
  const loadData = useCallback(async () => {
    try {
      const [dash, auth] = await Promise.all([fetchDashboard(), fetchAuthStatus()]);
      setError(null);
      setDashboard(dash);
      setAuthStatus(auth);
      setLastUpdated(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load data";
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    // Fetch on mount: loadData only sets state after its first await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  // Read ?connected= and ?error= query params after OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") || params.get("error")) {
      // The initial load above already fetches fresh data; just tidy the URL.
      window.history.replaceState({}, "", "/");
    }
  }, []);

  // Auto-poll every 15 minutes
  useEffect(() => {
    const timer = setInterval(() => void loadData(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadData]);

  const people: Person[] = [
    {
      id: "user1",
      name: firstName(authStatus?.user1.display_name ?? null, "You"),
      connected: !!authStatus?.user1.connected,
      metrics: dashboard?.user1 ?? null,
    },
    {
      id: "user2",
      name: firstName(authStatus?.user2.display_name ?? null, "Partner"),
      connected: !!authStatus?.user2.connected,
      metrics: dashboard?.user2 ?? null,
    },
  ];

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void loadData();
  }, [loadData]);

  return (
    <main className="page">
      <Header people={people} lastUpdated={lastUpdated} isRefreshing={isRefreshing} onRefresh={refresh} />

      {error && (
        <div className="alert" role="alert">
          <p><b>Couldn’t reach the backend</b></p>
          <p>{error}</p>
          <p>
            Make sure the API is running on port 8000 (<code>uvicorn main:app --reload</code> in{" "}
            <code>backend/</code>).
          </p>
        </div>
      )}

      <div className="stack">
        <RecoveryRow people={people} isLoading={isLoading} />
        <SleepRow people={people} isLoading={isLoading} />
        <HeartRow people={people} isLoading={isLoading} />
        <StepsRow people={people} isLoading={isLoading} />
      </div>

      <PeopleStrip people={people} status={authStatus} onChange={refresh} />

      <footer className="footer">
        Data from Google Health · refreshes every 15 minutes · for curiosity, not medical advice
      </footer>
    </main>
  );
}

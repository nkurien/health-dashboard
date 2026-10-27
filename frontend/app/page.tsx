"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { DashboardResponse, AuthStatus, Person } from "@/lib/types";
import { fetchDashboard, fetchAuthStatus, signoutUrl } from "@/lib/api";
import { firstName, todayISO } from "@/lib/format";
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
  const [viewDate, setViewDate] = useState(() => todayISO());
  const isToday = viewDate === todayISO();
  const latest = useRef(0); // ignore a slow response for a day we've already left

  // No state is set before the first await, so this is safe to call from effects.
  const loadData = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const [dash, auth] = await Promise.all([fetchDashboard(isToday ? undefined : viewDate), fetchAuthStatus()]);
      if (mine !== latest.current) return;
      setError(null);
      setDashboard(dash);
      setAuthStatus(auth);
      setLastUpdated(new Date());
    } catch (err) {
      if (mine !== latest.current) return;
      const msg = err instanceof Error ? err.message : "Failed to load data";
      setError(msg);
    } finally {
      if (mine === latest.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [isToday, viewDate]);

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

  // Auto-poll every 15 minutes (only worth doing for today)
  useEffect(() => {
    if (!isToday) return;
    const timer = setInterval(() => void loadData(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadData, isToday]);

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

  const changeDate = useCallback((date: string) => {
    setIsLoading(true);
    setViewDate(date);
  }, []);

  return (
    <main className="page">
      <Header
        people={people} lastUpdated={lastUpdated} isRefreshing={isRefreshing} onRefresh={refresh}
        viewDate={viewDate} onChangeDate={changeDate}
      />

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
        Data from Google Health · refreshes every 15 minutes on today · for curiosity, not medical advice ·{" "}
        <a href={signoutUrl} className="muted" style={{ textDecoration: "underline" }}>Sign out</a>
      </footer>
    </main>
  );
}

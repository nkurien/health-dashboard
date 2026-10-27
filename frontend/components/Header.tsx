"use client";

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { Person } from "@/lib/types";
import { greeting, longDate, MAX_LOOKBACK_DAYS, shiftDay, summaryLines, todayISO } from "@/lib/format";
import ThemeToggle from "./ThemeToggle";

export default function Header({
  people,
  lastUpdated,
  isRefreshing,
  onRefresh,
  viewDate,
  onChangeDate,
}: {
  people: Person[];
  lastUpdated: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** The day being shown, YYYY-MM-DD. */
  viewDate: string;
  onChangeDate: (date: string) => void;
}) {
  const now = new Date();
  const today = todayISO(now);
  const isToday = viewDate === today;
  const date = longDate(viewDate);
  const names = people.map((p) => p.name).join(" & ");
  const lines = summaryLines(people);

  return (
    <>
      <header className="header">
        <div>
          <h1>
            {isToday ? `${greeting(now)}, ${names}` : `Looking back, ${names}`}
          </h1>
          <div className="date-nav">
            <button className="icon-btn" onClick={() => onChangeDate(shiftDay(viewDate, -1))}
              disabled={viewDate <= shiftDay(today, -MAX_LOOKBACK_DAYS)} aria-label="Previous day">
              <ChevronLeft size={16} aria-hidden />
            </button>
            <p className="date">{isToday ? date : `${date} · ${viewDate.slice(0, 4)}`}</p>
            <button className="icon-btn" onClick={() => onChangeDate(shiftDay(viewDate, 1))}
              disabled={isToday} aria-label="Next day">
              <ChevronRight size={16} aria-hidden />
            </button>
            {!isToday && <button className="btn" onClick={() => onChangeDate(today)}>Today</button>}
          </div>
        </div>
        <div className="header-actions">
        <ThemeToggle />
        <button className="btn" onClick={onRefresh} disabled={isRefreshing} aria-label="Refresh health data">
          <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} aria-hidden />
          {isRefreshing
            ? "Syncing…"
            : lastUpdated
              ? `Synced ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Refresh"}
        </button>
        </div>
      </header>
      {lines.length > 0 && (
        <div className="summary">
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}
    </>
  );
}

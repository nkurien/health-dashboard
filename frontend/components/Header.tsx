"use client";

import { RefreshCw } from "lucide-react";
import type { Person } from "@/lib/types";
import { greeting, summaryLines } from "@/lib/format";
import ThemeToggle from "./ThemeToggle";

export default function Header({
  people,
  lastUpdated,
  isRefreshing,
  onRefresh,
}: {
  people: Person[];
  lastUpdated: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const now = new Date();
  const date = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const names = people.map((p) => p.name).join(" & ");
  const lines = summaryLines(people);

  return (
    <>
      <header className="header">
        <div>
          <h1>
            {greeting(now)}, {names}
          </h1>
          <p className="date">{date}</p>
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

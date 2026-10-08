"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Clock, Moon, Sun } from "lucide-react";
import {
  applyTheme, getThemeMode, setThemeMode, subscribeTheme, type ThemeMode,
} from "@/lib/theme";

const OPTIONS: Array<{ mode: ThemeMode; label: string; title: string; Icon: typeof Sun }> = [
  { mode: "auto", label: "Auto", title: "Follow the time of day", Icon: Clock },
  { mode: "light", label: "Day", title: "Day theme", Icon: Sun },
  { mode: "dark", label: "Night", title: "Night theme", Icon: Moon },
];

export default function ThemeToggle() {
  const mode = useSyncExternalStore(subscribeTheme, getThemeMode, () => "auto" as ThemeMode);

  // In auto mode, re-check the clock so a page left open flips at dusk/dawn.
  useEffect(() => {
    const timer = setInterval(() => {
      if (getThemeMode() === "auto") applyTheme();
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="seg" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ mode: m, label, title, Icon }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-label={title}
          title={title}
          onClick={() => setThemeMode(m)}
        >
          <Icon size={14} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export type ThemeMode = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "theme-mode";
/** Auto mode: light from 06:00 until 18:00 local time, dark otherwise. */
export const DAY_START_HOUR = 6;
export const NIGHT_START_HOUR = 18;

export function resolveTheme(mode: ThemeMode, now: Date = new Date()): Theme {
  if (mode === "light" || mode === "dark") return mode;
  const h = now.getHours();
  return h >= DAY_START_HOUR && h < NIGHT_START_HOUR ? "light" : "dark";
}

function storedMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage unavailable: stay on auto */
  }
  return "auto";
}

/** Sets <html data-theme> and data-theme-mode from the stored choice and the clock. */
export function applyTheme(): void {
  const mode = storedMode();
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolveTheme(mode);
}

const listeners = new Set<() => void>();

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getThemeMode(): ThemeMode {
  const v = document.documentElement.dataset.themeMode;
  return v === "light" || v === "dark" ? v : "auto";
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* ignore: choice just won't persist */
  }
  applyTheme();
  listeners.forEach((l) => l());
}

/** Inline script run before first paint so there is no flash of the wrong theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("${THEME_KEY}");if(m!=="light"&&m!=="dark")m="auto";var h=new Date().getHours();var t=m==="auto"?(h>=${DAY_START_HOUR}&&h<${NIGHT_START_HOUR}?"light":"dark"):m;var d=document.documentElement;d.dataset.theme=t;d.dataset.themeMode=m;}catch(e){}})();`;

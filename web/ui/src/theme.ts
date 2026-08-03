export type ThemeMode = "light" | "dark";

const KEY = "yacewo-theme";

export function getStoredTheme(): ThemeMode {
  const v = localStorage.getItem(KEY);
  if (v === "light" || v === "dark") return v;
  // Migrate old "system" (or missing) to an explicit choice.
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function storeTheme(mode: ThemeMode) {
  localStorage.setItem(KEY, mode);
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
}

export function cycleTheme(mode: ThemeMode): ThemeMode {
  return mode === "light" ? "dark" : "light";
}

export function themeLabel(mode: ThemeMode): string {
  return mode === "light" ? "Light" : "Dark";
}

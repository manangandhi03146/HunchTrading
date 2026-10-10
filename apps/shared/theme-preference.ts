export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "hunch.theme.v1";

export function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// Standalone so Vite can embed this same resolver before the first paint.
export function initialTheme(storageKey: string): Theme {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "light" || value === "dark") return value;
  } catch {
    // A blocked storage policy must not prevent the app from starting.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#102a22" : "#f5f4ee");
}

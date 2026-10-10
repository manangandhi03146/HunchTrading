import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Moon, Sun } from "lucide-react";
import {
  applyTheme,
  initialTheme,
  storedTheme,
  systemTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from "./theme-preference";
export type { Theme } from "./theme-preference";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState(() => initialTheme(THEME_STORAGE_KEY));
  const preference = useRef(storedTheme());

  useLayoutEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const followSystem = () => {
      if (preference.current === null) updateTheme(systemTheme());
    };
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      if (event.storageArea && event.storageArea !== window.localStorage)
        return;
      preference.current =
        event.newValue === "light" || event.newValue === "dark"
          ? event.newValue
          : null;
      updateTheme(preference.current ?? systemTheme());
    };
    media?.addEventListener("change", followSystem);
    window.addEventListener("storage", syncPreference);
    // Reconcile a device change between bootstrap and listener registration.
    followSystem();
    return () => {
      media?.removeEventListener("change", followSystem);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  const setTheme = (nextTheme: Theme) => {
    preference.current = nextTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Keep the switch usable for this tab when persistence is unavailable.
    }
    updateTheme(nextTheme);
  };
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const Icon = dark ? Moon : Sun;
  return (
    <button
      type="button"
      className="theme-switch"
      role="switch"
      aria-label="Dark theme"
      aria-checked={dark}
      title={`Switch to ${dark ? "light" : "dark"} theme`}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{dark ? "Dark" : "Light"}</span>
      <span className="theme-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

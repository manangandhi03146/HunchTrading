import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ThemeProvider,
  ThemeSwitch,
  useTheme,
} from "../../../../apps/shared/theme";
import { THEME_STORAGE_KEY } from "../../../../apps/shared/theme-preference";
import { HunchProvider } from "../providers/HunchProvider";
import { MockHunchClient } from "../adapters/MockHunchClient";
import { PredictionMarket } from "../components/PredictionMarket";

function deviceTheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(
    () =>
      ({
        get matches() {
          return dark;
        },
        addEventListener: (_event: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_event: string, listener: () => void) =>
          listeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
  return {
    change(nextDark: boolean) {
      act(() => {
        dark = nextDark;
        listeners.forEach((listener) => listener());
      });
    },
    listeners,
  };
}

function controls() {
  return render(
    <ThemeProvider>
      <ThemeSwitch />
    </ThemeProvider>,
  );
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("color-scheme");
});

describe("application themes", () => {
  it("restores a saved choice and persists keyboard changes across remounts", async () => {
    deviceTheme(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const user = userEvent.setup();
    const view = controls();
    const toggle = screen.getByRole("switch", { name: "Dark theme" });
    expect(toggle).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard(" ");
    expect(toggle).not.toBeChecked();
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    view.unmount();
    controls();
    expect(
      screen.getByRole("switch", { name: "Dark theme" }),
    ).not.toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("switch", { name: "Dark theme" })).toBeChecked();
  });

  it.each([null, "invalid"])(
    "uses the device theme when the stored value is %s",
    (storedValue) => {
      deviceTheme(true);
      if (storedValue !== null)
        localStorage.setItem(THEME_STORAGE_KEY, storedValue);
      controls();
      expect(screen.getByRole("switch", { name: "Dark theme" })).toBeChecked();
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    },
  );

  it("follows device changes until an explicit choice and removes its listener", async () => {
    const device = deviceTheme(false);
    const user = userEvent.setup();
    const view = controls();
    const toggle = screen.getByRole("switch", { name: "Dark theme" });
    device.change(true);
    expect(toggle).toBeChecked();
    await user.click(toggle);
    device.change(false);
    device.change(true);
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    view.unmount();
    expect(device.listeners.size).toBe(0);
  });

  it("synchronizes another tab's preference and resumes the device theme when cleared", () => {
    deviceTheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    controls();
    const toggle = screen.getByRole("switch", { name: "Dark theme" });
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "hunch.frontend.demo.v1",
          newValue: "dark",
        }),
      );
    });
    expect(toggle).not.toBeChecked();
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          newValue: "dark",
        }),
      );
    });
    expect(toggle).toBeChecked();
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          newValue: "light",
        }),
      );
    });
    expect(toggle).not.toBeChecked();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(toggle).toBeChecked();
  });

  it("keeps the switch usable when browser storage is blocked", async () => {
    deviceTheme(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    controls();
    const toggle = screen.getByRole("switch", { name: "Dark theme" });
    expect(toggle).toBeChecked();
    await userEvent.setup().click(toggle);
    expect(toggle).not.toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("preserves the selected outcome and entered stake when the app theme changes", async () => {
    deviceTheme(false);
    function ThemedWidget() {
      const { theme } = useTheme();
      return <PredictionMarket marketId="race-42" theme={theme} />;
    }
    const user = userEvent.setup();
    const mock = new MockHunchClient({ persist: false, latencyMs: 0 });
    const predict = vi.spyOn(mock, "predict");
    render(
      <ThemeProvider>
        <ThemeSwitch />
        <HunchProvider client={mock} defaultDemoConnected>
          <ThemedWidget />
        </HunchProvider>
      </ThemeProvider>,
    );
    const choice = await screen.findByRole("radio", { name: /Player B/ });
    await user.click(choice);
    const stake = screen.getByRole("textbox", { name: "Your stake" });
    await user.clear(stake);
    await user.type(stake, "21");
    await user.click(screen.getByRole("switch", { name: "Dark theme" }));
    expect(choice).toBeChecked();
    expect(stake).toHaveValue("21");
    expect(
      screen.getByRole("region", { name: "Prediction market" }),
    ).toHaveClass("hunch-theme-dark");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Review prediction/ }),
      ).toBeEnabled(),
    );
    expect(predict).not.toHaveBeenCalled();
  });
});

import type { ReactNode } from "react";
import { appUrl } from "./links";
import { Logo, WalletButton, useHunch } from "@hunch/react";
import { ThemeSwitch } from "./theme";
export function AppHeader({
  active,
  brand,
}: {
  active: "racing" | "esports" | "dashboard";
  brand?: ReactNode;
}) {
  const { mode } = useHunch();
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        {brand ?? <Logo />}
        <nav className="app-links" aria-label="Demo applications">
          {(["racing", "esports", "dashboard"] as const).map((app, index) => (
            <a
              key={app}
              href={appUrl(app)}
              aria-current={active === app ? "page" : undefined}
            >
              {app === "dashboard"
                ? "Developer console"
                : app === "racing"
                  ? "Racing demo"
                  : "Esports demo"}
            </a>
          ))}
        </nav>
        <div className="app-header-actions">
          <ThemeSwitch />
          <span className="network-badge">
            <i />
            {mode === "mock" ? "Demo mode" : "Solana Devnet"}
          </span>
          <WalletButton />
        </div>
      </header>
    </>
  );
}

# hunch frontend handoff — Developer C

Delivered on **`feat/widget-demos`**. The product name is **hunch** and the domain is **hunchtrading.tech**. The rename now includes packages, public APIs, environment variables, source filenames, CSS, and documentation. Previous branding aliases have been removed, so this is a breaking integration rename.

## Names to use after merging

| Integration surface | Current names                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Workspaces          | `@hunch/sdk`, `@hunch/react`, `@hunch/resolver`, `@hunch/racing`, `@hunch/esports`, `@hunch/dashboard`  |
| SDK                 | `Hunch`, `HunchConfig` from `@hunch/sdk`                                                                |
| React context       | `HunchProvider`, `HunchProviderProps`, `useHunch` from `@hunch/react`                                   |
| Client adapters     | `HunchClient`, `MockHunchClient`, `SdkHunchClient`; matching files under `packages/react/src/adapters/` |
| Configuration       | `VITE_HUNCH_MODE`, `VITE_HUNCH_PROGRAM_ID`, `VITE_HUNCH_MARKET_ID`; root `HUNCH_PROGRAM_ID`             |
| Styling             | `.hunch-*` classes; `--hunch-widget-*` widget variables; `--hunch-*` page variables                     |
| Demo storage        | `hunch.frontend.demo.v1`; theme preference remains `hunch.theme.v1`                                     |

Update teammate imports, JSX, environment files, custom CSS, and any unpublished program scaffolding to these names. Rerun `npm install` after merging so npm relinks the renamed workspaces. For the Anchor scaffold, use the program name and directory `hunch` as described in `programs/README.md`. This rename does not change PDA seeds, market/position layouts, deployed program addresses, or resolver authority rules.

The React build now clears its output through Vite before emitting declarations with TypeScript, so obsolete provider/adapter declaration filenames do not survive a rebuild or enter the package tarball.

## Bring this into your branch

From your existing checkout, commit or stash your own work first, then fetch and merge the frontend branch into your working branch:

```sh
git fetch origin
git merge origin/feat/widget-demos
```

Review conflicts in shared root documentation and `packages/sdk/src/client.ts` together with Developer B. Earlier SDK changes harden the standalone **mock** and fix emitted ESM import extensions. The branding update renames the SDK class/config exports and package imports; resolver source and shared types have branding-only comment/import changes. Live bindings and shared data shapes are unchanged. This delivery does not merge either teammate's feature branch.

## What shipped

- A redesigned developer console with readable overview rows, market creation/listing, events, and a working widget integration preview.
- The same moss, ivory, and orange identity across the embeddable React widget, Velocity Racing, and Nexus esports demos. Manrope is self-hosted with its OFL license in `packages/react/src/assets/`.
- Light and dark page themes with a keyboard-accessible header switch, persistent preference, device defaults, same-origin tab synchronization, and initialization before first paint.
- Racing and esports widgets follow the app theme. The console's **Widget theme** control offers **Follow app theme**, Light, and Dark; the copied JSX uses the resolved choice. Embeds and their portaled review dialogs retain independent theme scopes.
- Mobile market rows retain their question, status, pool, dates, and open action. Demo headers wrap the theme, account, and navigation controls.
- Demo reliability fixes: validate persisted bigint state; fall back safely on malformed storage; enforce prediction deadlines and one-time claims; reject invalid SDK mock operations; refresh lifecycle clocks; isolate query caches when the client changes; honor `showWalletButton` after resolution; default shared buttons to `type="button"`; and restore focus when closing prediction review. Regression tests cover these behaviors.

## Theme contract for developers and agents

| File                              | Responsibility                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/shared/theme-preference.ts` | Shared preference resolver, `hunch.theme.v1`, root attribute, native color scheme, and browser theme color.                                                             |
| `apps/shared/theme-bootstrap.ts`  | Vite HTML plugin used by all three apps; runs the same resolver before React and CSS paint. Keep it in each app's Vite plugin list.                                     |
| `apps/shared/theme.tsx`           | `ThemeProvider`, `useTheme()`, and `ThemeSwitch`. The provider wraps `HunchProvider` without changing its key, so toggling preserves account, outcome, and stake state. |
| `packages/react/src/tokens.css`   | Self-hosted font and semantic light/dark palettes. Page variables are `--hunch-*`; widget variables are `--hunch-widget-*`.                                             |
| `apps/shared/styles.css`          | Switch, shared header wrapping, fields, and reduced motion.                                                                                                             |
| `DESIGN.md`                       | Authoritative colors, typography, components, responsive behavior, and theme rules.                                                                                     |
| `.impeccable/design.json`         | Design inspection metadata and isolated interactive component examples.                                                                                                 |

The page uses `<html data-theme="light|dark">`. Change semantic tokens rather than adding hardcoded light backgrounds to components. `--hunch-line` / `--hunch-widget-border` are quiet dividers; `--hunch-control-border` / `--hunch-widget-control-border` identify fields and outcome choices with stronger contrast. Moss demo headers, console navigation, and code panels keep their dark frame in either page theme. Primary button text is white on burnt orange in light mode and dark moss on soft orange in dark mode.

The switch is a native button with `role="switch"`, accessible name **Dark theme**, and `aria-checked`. Space, Enter, and pointer input toggle it. A missing or invalid saved choice follows `prefers-color-scheme`, including device changes until an explicit selection. Choices synchronize across tabs of the **same origin**. Blocked storage preserves switching for the current tab; clearing only `hunch.theme.v1` and reloading restores device defaults.

Storage is per origin: ports 5173, 5174, and 5175, and `localhost` versus `127.0.0.1`, do not share preferences or mock data. Theme preference and the demo ledger (`hunch.frontend.demo.v1`) use separate entries. Do not clear the ledger to reset the theme.

When the hunch ledger is absent, the mock client imports a single validated previous same-origin snapshot with the `.frontend.demo.v1` suffix. It preserves bigint stakes, balances, markets, positions, races, and events, and removes the previous entry only after writing the hunch entry. An existing hunch entry always wins; malformed and ambiguous previous snapshots are left untouched. Blocked writes preserve the readable previous state for the current session.

The exported React API remains `theme="light" | "dark"`. `ThemeProvider` is app infrastructure, not a new library export. A third-party host can select its own widget theme without opting into hunch's page or storage behavior.

## Run and verify

Use Node 22.12+, 24 LTS, or 26+, and npm 10+. This scaffold does not have a committed npm lockfile; use `npm install` from the root. Start the apps in separate terminals:

```sh
npm install
npm run dev        # racing: http://127.0.0.1:5173
npm run esports    # esports: http://127.0.0.1:5174
npm run dashboard  # console: http://127.0.0.1:5175
npm test
npm run build
```

On PowerShell, use `npm.cmd` when execution policy blocks `npm.ps1`.

Validation for this delivery: **58 tests across six files pass**; the SDK, React package, resolver scaffold, and all three app builds pass. Five additional persistence regressions cover namespace migration, hunch-state precedence, invalid/unrelated data, ambiguous snapshots, and blocked writes. Browser checks for the theme delivery covered Light and Dark at 1440px and 390px widths, reload persistence, independent preview themes, and mobile creation fields. No horizontal page overflow appeared at those widths. Theme tests also verify keyboard activation, system preference changes, cross-tab events, blocked storage, and preservation of an entered stake and selected outcome.

Development retains dependency warnings about Vite's externalized `buffer` module and React Router v7 future flags. The checked previews logged no runtime errors. Builds report large wallet-related chunks; these are existing integration dependencies, not evidence of live settlement.

Rename verification covered all three running apps, the console's generated `@hunch/react` / `HunchProvider` examples, and both widget palettes. The existing console-created market survived the storage migration. The rebuilt SDK imports as `Hunch`, and the React package dry run contains no obsolete branding filenames or declarations.

For a quick demo: create a future-dated market in the console; try its integration preview in both widget themes; connect a demo account in racing, predict Player A, close predictions, start the deterministic fixture, and claim once. TEST credits and receipts are clearly marked simulated. See [apps/README.md](apps/README.md) for the full script.

## A/B integration work still required

The frontend demo runs in **mock mode**. The checked-out Anchor program and live SDK/resolver integration remain unfinished; setting `VITE_HUNCH_MODE=sdk` alone does not enable Devnet settlement. The branding update changes program setup names and resolver imports/comments; contract and resolver behavior is unchanged.

Developer A supplies the deployed Devnet program, agreed IDL/account layout, and zero-decimal TEST mint. Developer B implements the live SDK reads and provides typed `SdkBindings` to each app's `HunchProvider` in `src/main.tsx`:

- `predict`, `claimWinnings`, and `createMarket` receive the wallet signer and return real signatures.
- `getClaimableAmount` returns authoritative integer amounts and claimed state; `listMarkets` and `getEvents` supply actual metadata and resolver activity.
- `getRace` and `startRace` connect to the authorized game server, including idempotent starts and canonical result status. Browser code must not choose or sign a live winner.

The exact contract, optional position binding, and integration example are in [packages/react/README.md](packages/react/README.md#developer-b-integration-requirements) and [SdkHunchClient.ts](packages/react/src/adapters/SdkHunchClient.ts). `VITE_RESOLVER_API_URL` is reserved until the backend route schema is agreed. Missing live capabilities fail explicitly rather than falling back to simulated data. Mock tests and frontend build success do not validate on-chain escrow, event verification, cancellation/refunds, or Devnet settlement.

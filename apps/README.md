# hunch demo applications

Three React/Vite applications consume the shared `@marketkit/react` widget:

| Application        | Development URL       | Preview URL           |
| ------------------ | --------------------- | --------------------- |
| Velocity Racing    | http://127.0.0.1:5173 | http://127.0.0.1:5183 |
| Nexus Invitational | http://127.0.0.1:5174 | http://127.0.0.1:5184 |
| Developer console  | http://127.0.0.1:5175 | http://127.0.0.1:5185 |

## Run locally

Use Node 22.12+ (22 LTS), 24 LTS, or 26+ and npm 10+. Install from the root, then run each app in a separate terminal:

```sh
npm install
npm run dev
npm run esports
npm run dashboard
```

On Windows PowerShell, use `npm.cmd` if the execution policy blocks `npm.ps1`. The apps bind to `127.0.0.1` and require their listed ports to be free.

```sh
npm run build
npm test
npm run preview --workspace @marketkit/racing
```

Preview requires a successful build; replace the workspace name to preview another app. Development uses workspace source aliases, so separate library builds are unnecessary for `dev`.

## Light and dark themes

Use the **Light / Dark** switch in any app header. It follows the device setting until you choose a mode, then saves that choice as `hunch.theme.v1`. The choice survives reloads and syncs between tabs on the same origin. Different ports and `localhost` versus `127.0.0.1` have separate preferences, just like the demo store. Removing only the theme entry and reloading restores device-following behavior; this does not reset demo markets. If browser storage is blocked, the switch still works for the current tab.

Racing and esports widgets follow their page theme. The console's **Widget theme** selector defaults to **Follow app theme**, with Light and Dark overrides for testing independent embeds. Theme changes preserve entered stakes and selected outcomes.

The app-only provider and switch are in `apps/shared/theme.tsx`; the Vite bootstrap in `apps/shared/theme-bootstrap.ts` applies the preference before first paint. Palettes live in `packages/react/src/tokens.css`. Keep the exported widget's `theme="light" | "dark"` API independent of app preferences. See [Developer C's handoff](../DEVELOPER_C_HANDOFF.md) and [the design system](../DESIGN.md).

## Try the simulated flow

Mock mode is the default and requires no wallet extension.

1. Open Velocity Racing and connect the **Demo account**.
2. Choose Player A, enter a whole-number TEST stake, then review and confirm.
3. Select **Close demo predictions**, then **Start race**.
4. After the 12-second fixture finishes, claim the simulated winning payout.
5. Select **New demo race** to create a fresh market. Previous positions remain in the local store.
6. Open Nexus to switch between the three fixture matches, including the resolved Team Echo match.
7. In the developer console, create a market and try its widget in the Integration preview.

TEST credits have no value. Race results are deterministic fixtures: Player A wins. The race animation is illustrative. No blockchain transactions or real signature verification occur in mock mode. Nexus has no automatic tournament progression; its open fixtures close at their configured deadlines, and its resolved match is preloaded.

Mock state persists in browser local storage under `marketkit.frontend.demo.v1`. Storage is separate for each origin, so different ports and `localhost` versus `127.0.0.1` do not share markets, balances, positions, or events. The console's Events page displays that origin's activity. Removing only that storage entry and reloading restores fresh fixtures.

## Configure a Devnet integration

Each app has an `.env.example`; copy it to `.env.local` in that app's directory. `VITE_MARKETKIT_MODE` accepts `mock` or `sdk`; `VITE_SOLANA_CLUSTER` must be `devnet`.

SDK mode is an integration surface, not a completed live demo. The checked-in live SDK and required game-server bindings are unfinished. Setting environment variables alone does not enable live settlement. Implement the SDK and provide `sdkBindings` to the app's `MarketKitProvider`; missing capabilities report errors rather than substituting fixtures. See [the React package integration contract](../packages/react/README.md#developer-b-integration-requirements).

Use `VITE_MARKETKIT_MARKET_ID` for an initial market. Racing also accepts `?market=<id>`. Nexus selects the configured market when present in the returned index, otherwise the first available match. A live race must obtain its authoritative result from the game server. Browser code must not choose or sign a live winner.

For deployed cross-app navigation, configure `VITE_RACING_APP_URL`, `VITE_ESPORTS_APP_URL`, and `VITE_DASHBOARD_APP_URL`. Their defaults point to the local development ports. Vite variables are public; never include private keys or signing secrets.

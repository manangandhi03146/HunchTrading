# hunch frontend — Developer C

The product is **hunch**, at **https://hunchtrading.tech**. Existing `@marketkit/*` workspace names, SDK exports, and environment variables are retained for compatibility with Developer A/B's current integration contract.

Reusable React widget, Velocity Racing demo, Nexus esports demo, and the developer console. All demo credits are nonredeemable; live signing is restricted to Solana Devnet. Changes are confined to frontend-owned code. The Anchor program, SDK, and resolver sources are untouched.

## Run

Node 22.12+ and npm 10+ recommended. From the monorepo root:

```sh
npm install
npm run dev --workspace @marketkit/racing     # http://127.0.0.1:5173
npm run dev --workspace @marketkit/esports    # http://127.0.0.1:5174
npm run dev --workspace @marketkit/dashboard  # http://127.0.0.1:5175
```

Run the three development commands in separate terminals. The defaults are mock mode, no wallet extension required. Connect **Demo account**, choose an outcome, review and confirm a prediction. In racing, **Close demo predictions** then **Start race**. After the 12-second fixture finishes, claim your eligible payout. **New demo race** creates a new market and keeps old positions intact.

```sh
npm run build                               # all existing workspace builds
npm run build --workspace @marketkit/react   # distributable JS, declarations, CSS
npm run test --workspace @marketkit/react    # Vitest + Testing Library
```

The existing root scripts are preserved. Optional aliases `dev:racing`, `dev:esports`, and `dev:dashboard` can be added by the team; the commands above already work. Widget build first builds the SDK declarations it consumes. Vite development aliases resolve the workspace sources directly.

## Embed

```tsx
import { MarketKitProvider, PredictionMarket } from "@marketkit/react";
import "@marketkit/react/styles.css";

export function App() {
  return (
    <MarketKitProvider mode="mock">
      <PredictionMarket marketId="race-42" theme="dark" />
    </MarketKitProvider>
  );
}
```

Configure the provider once, above all widgets. Supported widget options: `marketId`, `theme` (`dark`/`light`), `variant` (`default`/`compact`), `showPool`, `showWalletButton`, `className`, `onPredictionSuccess`, `onError`. `PredictionWidget` is a compatibility alias. The library includes its own styles and uses container queries for narrow embeds.

## Configuration

Copy the relevant `apps/<app>/.env.example` to `.env.local`:

| Variable                                                                | Default / purpose                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `VITE_MARKETKIT_MODE`                                                   | `mock` or `sdk` (no automatic fallback from failed real calls)                                  |
| `VITE_SOLANA_CLUSTER`                                                   | `devnet`; other values stop startup                                                             |
| `VITE_MARKETKIT_PROGRAM_ID`                                             | Deployed program's public address                                                               |
| `VITE_TEST_TOKEN_MINT`                                                  | Public address of the zero-decimal Devnet TEST mint                                             |
| `VITE_MARKETKIT_MARKET_ID`                                              | Initial race/match ID; must actually exist in SDK mode                                          |
| `VITE_RESOLVER_API_URL`                                                 | Reserved for the backend integration below; not called without an agreed API                    |
| `VITE_RACING_APP_URL`, `VITE_ESPORTS_APP_URL`, `VITE_DASHBOARD_APP_URL` | Optional public URLs for cross-app links when deployed; defaults are local ports 5173/5174/5175 |

Vite variables are public. Never put game-server signing keys, resolver keys, or seed phrases in them. Phantom and Solflare are configured using Wallet Adapter; Wallet Standard wallets are also detected. A missing extension opens the standard wallet selection UI. The adapter verifies the RPC genesis hash before exposing a signer to live mutation bindings.

Mock data is stored per browser origin in `localStorage` under `marketkit.frontend.demo.v1`, with bigint amounts serialized as strings. Different app ports have separate simulated stores. The dashboard's integration preview shares its created markets. Live mode uses shared Devnet state across applications. Mock receipts are always labeled and never linked to Explorer. Deleting that one storage entry starts fresh fixtures; no blockchain state is affected.

## Developer B integration requirements

The checked-in SDK currently exposes `MarketKit`, `getMarket`, and `getPositions`, but its live implementation throws “pending.” Its mock omits balances, claim status, close validation, and repeated-claim protection, so the frontend uses a separate demo client rather than weakening those guarantees.

`SdkMarketKitClient` consumes the existing reads without inventing SDK exports. Supply typed `SdkBindings` through the provider once B implements the methods. See `src/adapters/SdkMarketKitClient.ts` for the exact TypeScript contract.

```tsx
<MarketKitProvider
  mode="sdk"
  programId={programId}
  tokenMint={testMint}
  sdkBindings={bindingsFromDeveloperB}
>
  <App />
</MarketKitProvider>
```

| Binding                           | Required behavior                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `predict(params, wallet)`         | Use the provided wallet signer; submit TEST stake; return a real signature           |
| `claimWinnings(params, wallet)`   | Submit the contract claim/refund; return a real signature                            |
| `createMarket(params, wallet)`    | Return created market + real signature; retain off-chain metadata                    |
| `getClaimableAmount(id, address)` | Return authoritative `{ amount: bigint, claimed: boolean }`                          |
| `getPositions(id, address)`       | Optional enriched positions with claimed state; existing SDK read is fallback        |
| `listMarkets()`                   | Developer-visible market index, including metadata/created timestamp where available |
| `getEvents()`                     | Actual resolver activity; simulated logs are rejected in SDK mode                    |
| `getRace(id)`                     | Server-owned status, start timestamp, duration, and final winner; `simulated:false`  |
| `startRace(id)`                   | Start the authorized game server only after the prediction window closes             |

The frontend reads TEST balances through parsed SPL token accounts (zero decimals enforced), and polls actual signature statuses until confirmed/finalized. The wallet signer is explicit; missing bindings raise actionable errors. There is no browser winner selection, signing secret, or direct resolver `resolveMarket` call. B's game server must create/sign the canonical result and submit it to the resolver. B should bind game routes to configured market IDs and make start requests idempotent.

For each app, pass the same configured `sdkBindings` object in `src/main.tsx`. `VITE_RESOLVER_API_URL` remains unused until B agrees the game/status/events route schema, so we don't invent endpoint behavior. Live race reset is disabled; create/select a new market and use `?market=<id>`.

## Verification and demo script

Tests cover rendering, selection, disconnected accounts, invalid/over-balance stakes, closed markets, pending confirmation, rejected transactions, resolved/ineligible claims, bigint precision, full fixture lifecycle, concurrent duplicate claims, fresh race IDs, missing SDK capabilities, Devnet enforcement, and shared widget imports.

1. Open the console; create a market with a future close and distinct outcomes.
2. On Integration, copy the generated component code; switch theme/size and try the working preview.
3. Open Velocity; connect demo account, stake on Player A, review/confirm, close predictions, start race, claim.
4. Open Nexus; switch matches, including the resolved Team Echo fixture.
5. Open Events to see the clearly marked local event stream.

The figures are pool shares, not probabilities or promised odds. Amounts and demo payout calculation use integer bigint. Live claim amounts are supplied by the SDK binding, never calculated as authoritative in the widget. Offline/failed reads expose retry controls. UI checks complement contract enforcement. Atomic cancellation/refund correctness depends on A/B's actual implementation.

# Integration plan — going live (hunch × MarketKit)

**Status (post-merge):** `main` now contains everything integrated — the Anchor
contract (live on Devnet + local), the SDK with shared types + IDL, Dev C's
widget/apps (complete in **mock mode**), and the resolver scaffold. The job now
is to connect the frontend to the live program. Priority order:
**real SDK reads/writes → signed-event resolution → live UI → demo polish.**

## Shared config (everyone uses these)

| Key | Value |
|---|---|
| Program ID | `J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP` |
| Devnet RPC | `https://api.devnet.solana.com` |
| Explorer | https://explorer.solana.com/address/J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP?cluster=devnet |
| IDL + types | `packages/sdk/src/idl/marketkit.{json,ts}` |
| TEST mint (0 decimals) | `9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs` → `VITE_TEST_TOKEN_MINT` |
| Resolver pubkey | `6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt` → set as each market's `resolver` |

### On-chain PDA seeds (for the SDK to derive accounts)
- **Market**: `["market", authority, market_id(32 bytes)]`
- **Position**: `["position", market, wallet, [outcome]]`
- **Vault** (escrow token acct, owned by Market PDA): `["vault", market]`

> ⚠️ The contract stores `market_id`, `deadline`, `pool[2]`, `status`,
> `winning_outcome`, `token_mint` — **not** the question text or outcome labels.
> Those are off-chain metadata (plan §2). Dev B needs a small metadata store
> (simplest: the resolver service keyed by `market_id`).

---

## Developer B — SDK + Automation (`packages/sdk/`, `services/`)

Branch `feat/sdk-resolver` (currently empty — start from updated `main`).
You are the critical blocker now: the UI is ready and waiting for live data.

| # | Task | File(s) | Prio |
|---|------|---------|------|
| B1 | Implement the real `MarketKit` methods (the `mock:false` paths): `createMarket`, `getMarket`, `predict`, `resolveMarket`, `claimWinnings`, `getPositions`. Use `@coral-xyz/anchor` + the committed IDL, derive the PDAs above, return **real tx signatures**. | `packages/sdk/src/client.ts` | P0 |
| B2 | Wallet-signer plumbing: accept a `WalletSigner` (`publicKey`, `signTransaction`), build + partial-sign + send transactions (user is fee payer + stake authority; the Market PDA signs vault payouts on-chain). | `packages/sdk/src/` | P0 |
| B3 | Implement the **`SdkBindings`** object and hand it to each app's `MarketKitProvider` in `apps/*/src/main.tsx`. Exact interface in `packages/react/src/adapters/SdkMarketKitClient.ts`. | new `services/` or `packages/sdk/` export | P0 |
| B4 | Off-chain metadata store keyed by `market_id` (question + outcome labels), served to `listMarkets()`/`getMarket()`. Simplest home: the resolver service. | `services/resolver/` | P0 |
| B5 | Resolver service: ed25519-verify signed game events (tweetnacl), replay-protect by `eventId`, validate market/outcome/deadline, then call `resolve_market` with the **resolver keypair**. Expose `/markets` + `/events`. | `services/resolver/src/index.ts` | P0 |
| B6 | Minimal game/race server (with Dev C) that signs a canonical result when a race ends and POSTs it to the resolver. Back `getRace`/`startRace`. Browser must never pick/sign the winner. | new `services/race/` | P1 |
| B7 | E2E in SDK mode against Devnet: `create → stake → resolve → claim` through the UI; confirm real Explorer links. | `tests/` | P0 |

### The `SdkBindings` contract you must fulfill
```ts
interface SdkBindings {
  predict(params:{marketId;outcome;amount:bigint}, wallet): Promise<{signature}>;
  claimWinnings(params:{marketId;outcome}, wallet): Promise<{signature}>;
  createMarket(params, wallet): Promise<{market; signature}>;
  getClaimableAmount(marketId, walletAddress): Promise<Claimable>;   // authoritative integer + claimed flag
  getPositions(marketId, walletAddress): Promise<Position[]>;
  listMarkets(): Promise<Market[]>;                                  // getProgramAccounts over Market PDAs
  getEvents(): Promise<MarketEvent[]>;                               // resolver activity
  getRace(marketId): Promise<RaceState>;
  startRace(marketId): Promise<RaceState>;
}
```
- Mutating methods **must** return real base58 signatures — the client rejects anything containing `MOCK`.
- `getClaimableAmount` = `position.amount × total_pool ÷ winning_pool` (integer floor) + the position's `claimed` flag — read straight from chain.

---

## Developer C — Frontend + Demo (`packages/react/`, `apps/`)

Branch `feat/widget-demos` (shipped; mock mode complete). Remaining work is the
live-mode wiring + one bug fix.

| # | Task | File(s) | Prio |
|---|------|---------|------|
| C1 | Real wallet adapter (Phantom) producing a live `WalletSigner` for SDK mode, replacing the demo wallet. | `packages/react/src/components/WalletButton.tsx`, provider | P0 |
| C2 | **Fix the Devnet genesis-hash guard** — the constant is truncated and blocks all live signing. Use `EtWTRABZaYq6iMfeYKouRu166VU2xqa1VM7zTVz4yYg`, and allow the local-validator hash when testing locally. | `packages/react/src/adapters/SdkMarketKitClient.ts:88` | P0 |
| C3 | Plug Dev B's `SdkBindings` into each `apps/*/src/main.tsx` `MarketKitProvider`; set env: `VITE_MARKETKIT_MODE=sdk`, `VITE_SOLANA_CLUSTER=devnet`, `VITE_MARKETKIT_PROGRAM_ID`, `VITE_TEST_TOKEN_MINT`, `VITE_RESOLVER_API_URL`. | `apps/*/.env.local`, `src/main.tsx` | P0 |
| C4 | Live-test C5/C6: connect wallet → see live market state → predict → claim on Devnet; verify Explorer links render. | apps | P0 |
| C5 | Coordinate with B on the race-server contract (`getRace`/`startRace`/result signing). | — | P1 |
| C6 | Demo polish (C8): README screenshots, pitch, rehearse the live happy path. | `README.md`, `DESIGN.md` | P1 |

Mock mode stays the fallback for the live demo (plan §7): if SDK mode isn't
solid by the freeze, present mock mode and **clearly label it simulated**.

---

## Developer A — Blockchain (me)

- ✅ **TEST mint created** — `9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs` (0 decimals, classic SPL Token), 1,000,000 TEST minted to Dev A's treasury.
- ✅ **Resolver key generated** — pubkey `6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt`. Secret lives at `~/.config/solana/marketkit-resolver.json` (uncommitted); Dev A hands it to whoever runs the resolver, out-of-band.
- ⏳ Support B's PDA derivations / account-layout questions (seeds above).
- ⏳ **A8** cancellation + refunds (P1, optional).

### TEST faucet (fund a demo wallet)
Dev A (mint authority) tops up any wallet with TEST — run per demo wallet:
```sh
spl-token mint 9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs 1000 \
  --recipient-owner <DEMO_WALLET_PUBKEY> --url devnet
```
(Creates the recipient's token account if needed. Recipients also need a little
Devnet SOL for rent/fees — point them at `mlh.link/solana-faucet`.)

## Branch hygiene
`main` is the integration branch. **Dev B:** start from updated `main`
(`git fetch && git reset --hard origin/main` on `feat/sdk-resolver`, or branch
anew). **Dev C:** `git merge origin/main` into `feat/widget-demos`. Open PRs
into `main`; the shared type/account layout changes get a quick team review.

## Before the demo — definition of done
`create → stake → resolve → claim` runs through the **racing app on Devnet**
with a real wallet, the resolver auto-settles from a signed race result, and the
winner claims real TEST tokens — with a working Explorer link on screen.

# hunch functionality verification

Verified on 2026-10-10 America/New_York (2026-10-11 UTC), Windows 11 Home, Node 22.19.0. This is a functionality audit, not evidence of a completed real Devnet lifecycle.

## Checkouts and scope

- Preserved frontend: `feat/widget-demos`, source `85d15bf`, at `C:\Users\Manas\Downloads\hackru`. Its working tree was clean before and after this audit.
- Integration: `feat/devnet-lifecycle`, starting this audit at `bb71068`, in the isolated Codex worktree. Audit changes are confined to SDK browser initialization, tests and documentation. No app files, public SDK interfaces, deployed program or team keys were changed.
- Main remains `49a5e7055d3a490c3c7791d03315ef6107fb28e9`. Frontend and lifecycle branches have not been merged together.

## Verified behavior

| Check | Result and limits |
| --- | --- |
| Original frontend | Full workspace production build passes; all 58 React tests pass |
| Integration | Full workspace production build passes; 377 SDK tests, 56 React tests, 120 resolver tests pass on Windows; one POSIX permissions test is skipped |
| Lifecycle harness | All six safeguard tests pass; ordinary tests do not broadcast Devnet transactions |
| Contract | Previously verified Linux CI has 18 passing Rust tests, with the deadline regression failing against original bytecode for the intended reason; Rust source was not changed during this audit |
| Dashboard simulation | Create market, connect demo account, reject zero stake, confirm 25 TEST prediction, update pool/balance/position, copy snippet, persist market across reload, inspect/filter events |
| Themes | Dark/light switch preserves in-progress outcome/amount; light theme survives reload; original dark preference restored |
| Racing simulation | Fresh market, 100 TEST prediction, close predictions, deterministic race, resolve Player A, claim 100 TEST, prevent another claim in UI |
| Esports simulation | Open match list and resolved Orbit/Echo render; resolved inputs disabled; Team Echo shown as winner |
| Small viewport | Esports and dashboard overview at 390 × 844 have no document horizontal overflow; other pages/racing mobile layout were not established |
| Resolver HTTP demo | Actual loopback Fastify server verifies Ed25519 events, settles racing/esports on explicit mock ledger, returns original record on replay and rejects repeat/losing claims; independent HTTP SDK clients share state; no blockchain signature |
| Actual Devnet SDK reads | Fresh post-fix smoke passes: executable program and two existing markets read through Anchor adapter; reads only, no wallet/stake/claim submitted |
| Actual browser SDK reads | Separate Vite-served, read-only SDK page reports PASS, correct Devnet genesis, two markets and decoded pools for `9xkdZGMXWEeGNCmwtN3rKra5gvPNNQotk7sUhxhEvCQm`; no browser warnings/errors on that page and no app bindings involved |

Browser receipts, race state and balances above are local simulation. The audit created a clearly named verification market and a new simulated race, without deleting previous markets. Temporary browser tabs/server and viewport override were removed; original dev servers were preserved. Screenshots are retained locally under ignored `.data/qa/`.

## Defects found and fixed

1. **SDK browser startup crash.** SDK mode produced a blank page and `ReferenceError: Buffer is not defined` while SPL Token evaluated. Initializing Buffer in the adapter constructor was too late. The SDK now initializes its existing npm Buffer dependency before adapter/dependency evaluation, using explicit `buffer/index.js` and preserving native Node Buffer. The browser page renders after the fix. A fresh-process published-entry import regression starts without a host Buffer global; existing wallet transaction tests still pass. This fixes startup, not the missing app integration below.
2. **Resolver test deadline.** The protected-path startup test launches up to three processes, each with a 15-second child deadline. Its default five-second Vitest deadline expired under concurrent builds. Only that test now has a 46-second outer deadline; assertions and child deadlines are unchanged. The full resolver suite passes under concurrent build load.

## Remaining functional gaps

1. **Browser apps do not connect the completed live SDK.** All three app providers omit `sdkBindings`. React requires bindings for listing, creation, predictions, claimable amounts, claims, events and race operations. Its fallback `MarketKit` compatibility class still throws `real impl pending` for live `getMarket`/`getPositions`; the working live API is `Hunch`/`AnchorMarketAdapter`. Setting SDK mode and public program/mint variables alone cannot produce a usable live app. The startup fix reveals a rendered SDK workspace, but usable live market data was not verified there. The frontend owner must connect the existing live API and resolver metadata/event/race sources, or explicitly scope unsupported demo controls. No bindings, mock fallback or receipts were invented to hide this gap.
2. **Frontend branch needs the reviewed Devnet guard.** `feat/widget-demos` still has the truncated genesis string in `SdkHunchClient.ts`. The full correct hash and regressions are on `feat/devnet-lifecycle`. A clean frontend build does not prove its signing guard accepts actual Devnet. Integrate both branches before live wallet testing.
3. **Real lifecycle credentials/funding unavailable.** Developer A controls the resolver key; the user has no secure path or treasury authority. The refreshed read-only audit at `2026-10-11T01:10:37.707Z` found zero resolver SOL and 999,900 treasury TEST. The user prohibited recreating team keys or transferring funds. No real lifecycle was attempted and no lifecycle transaction signatures exist.
4. **Deployed deadline guard needs an approved upgrade.** Program `J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP` remains at deployment slot `509647737`. Earlier unsigned simulation accepted early resolution. The tested guard has not been deployed. A correctly timed lifecycle can use this deployment; the chain still does not enforce the deadline.

Nonblocking observations: React Router future-flag warnings, a transitive Vite Buffer externalization warning after successful startup, Zod comment-annotation warnings and a roughly 505 kB dashboard chunk. These are not test failures or proof of live functionality.

## Reproduce

From the integration worktree after `npm ci`:

```sh
npm run build
npm test
npm run test:devnet-harness
npm run demo
npm run smoke:devnet --workspace @hunch/sdk
npm run devnet:audit
```

For browser startup, configure `VITE_MARKETKIT_MODE=sdk`, the public program above and `VITE_TEST_TOKEN_MINT=9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs`, then start the dashboard on an unused port. No private key is needed to reproduce startup or the missing-binding gap. A rendered page is not a connected live client.

Complete real-run setup/custody constraints: [Devnet runbook](devnet-lifecycle.md). Previous proof: [18-test contract CI](https://github.com/manangandhi03146/HunchTrading/actions/runs/38097003483), [Node 24 Linux/Windows CI](https://github.com/manangandhi03146/HunchTrading/actions/runs/38097650300). These runs predate the additional SDK import test and browser fix.

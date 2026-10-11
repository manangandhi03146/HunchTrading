# Hunch full app

The dashboard is now the main application. `/` is the public home, `/markets` discovers markets, `/markets/new` creates one, `/markets/:marketId` is its shareable trading page, and `/portfolio` shows the connected participant's positions. `/help`, `/overview`, `/integration`, `/events`, `/racing`, and `/esports` belong to the same app. Dedicated demo workspaces remain available for developers; a deployment needs only the dashboard frontend.

## Run locally

From the repository root:

```sh
npm install
npm run dev:shared
```

In another terminal:

```sh
npm run dev
```

Open http://127.0.0.1:5175. Create a market, open its dedicated page, connect a demo account and predict. Open the same link in another browser session: it sees the same market and pools, with its own identity and 1,000 simulated credits. Reloading a tab retains its session; closing a session or restarting the backend can invalidate it. The local shared ledger is deliberately in memory and resets on backend restart. Never present it as a durable or real-money ledger. `?demo=local` explicitly selects the older browser-local demo; its markets cannot be shared with another device.

All development servers bind to loopback. Other devices cannot use a localhost URL pointing to your computer. Remote hosting needs a public HTTPS origin and the deployment configuration below.

## Resolve shared demo markets as the local operator

Create a **new simulated game-event key**, not a team treasury or resolver key:

```sh
npm run demo:key --workspace @hunch/resolver
```

This creates `.data/shared-demo-game-keypair.json` with owner-only access and refuses to overwrite an existing file. Keep it outside committed files. Restart the shared API with `SHARED_DEMO_GAME_KEYPAIR_PATH` pointing to its absolute path. On PowerShell:

```powershell
$env:SHARED_DEMO_GAME_KEYPAIR_PATH = (Resolve-Path .data/shared-demo-game-keypair.json).Path
npm run dev:shared
```

Create a new market after restarting. After its actual deadline, sign an operator-verified result; replace MARKET_ID with the new ID and choose the actual winning outcome (0 or 1):

```sh
npm run sign-event --workspace @hunch/resolver -- --keypair-path /absolute/path/to/shared-demo-game-keypair.json --app-id hunch-web --market-id MARKET_ID --event-id MARKET_ID-finished --outcome 1
```

Save the command's **signed public event** output to a JSON file (not the private key), then submit:

```sh
npm run submit-event --workspace @hunch/resolver -- --event-file /absolute/path/to/signed-event.json --url http://127.0.0.1:8787
```

The browser cannot choose or submit an unsigned winner. The resolver verifies the registered application signature, market mapping and deadline. Open the resolved market to claim. If submission is uncertain, inspect `/v1/events/MARKET_ID-finished` before retrying the identical event. Do not generate a different event ID to bypass replay protection.

## Build and serve one site

```sh
npm run build
npm run serve:app
```

The app server listens at http://127.0.0.1:3000, serves the dashboard build, falls back to `index.html` for deep links, and proxies `/v1/*` and `/health` to `HUNCH_API_URL` (default http://127.0.0.1:8787). Use an HTTPS reverse proxy in a hosted environment. `PORT` and `HOST` configure the app server; leave the resolver private behind it. TLS termination and public exposure are operator deployment actions, not performed by this change.

For a hosted **shared demo**, build with `VITE_HUNCH_MODE=mock` and `VITE_HUNCH_DEMO_API_URL=https://YOUR_ORIGIN` (the frontend origin). Run the resolver in mock mode with `MOCK_HTTP_ACCESS=token`, a server-only `MOCK_API_TOKEN`, and exact `MOCK_ALLOWED_ORIGINS=https://YOUR_ORIGIN`. Set `HUNCH_DEMO_PROXY_TOKEN` to the matching token **on the app server only**. Never place the token in a `VITE_*` variable or frontend bundle. Register `hunch-web` with a protected game-event key using the resolver `register` command. The general resolver's mock adapter also keeps its ledger in memory; it is suitable for a bounded demo, not a persistent hosted trading service. Add rate limiting at the HTTPS proxy, set a session policy, and do not expose the backend directly.

## Live Devnet configuration

The reviewed SDK/resolver implementation from `feat/devnet-lifecycle` is included without changing its public transaction interfaces, IDL, PDAs, program ID or contract. The React adapter now uses its wallet-signed creation, prediction and claim methods, checks the full Devnet genesis hash, and refuses mock receipts in live mode.

Build with `VITE_HUNCH_MODE=sdk`, `VITE_SOLANA_CLUSTER=devnet`, and your public `VITE_HUNCH_PROGRAM_ID`, `VITE_TEST_TOKEN_MINT`, and optionally `VITE_SOLANA_RPC_URL`. If unset, the adapter uses the recorded approved TEST mint; use the exact deployed program configuration your team reviewed. Start the resolver with `RESOLVER_MODE=anchor`, `MOCK_HTTP_ENABLED=false`, an absolute protected `RESOLVER_KEYPAIR_PATH` **outside Git**, the expected resolver public key, mint, program and RPC. Set `CORS_ALLOWED_ORIGINS` to the exact public frontend origin. Follow `services/resolver/README.md` for startup validation and trusted application/market registration. Preserve `.data/resolver.sqlite` on persistent storage: registrations, signed-event replay records, activity and published metadata live there. Chain markets, stakes and claims live on Devnet.

Creation requires a wallet that supports transaction signing and `signMessage`. After the on-chain creation, the wallet signs the question and outcome labels. `/v1/metadata` verifies the signature against the market's on-chain creator before saving immutable labels. Public readers use those labels while all pools, deadlines, winners and positions come from the SDK's chain reads. Never trust the metadata API as an authority for token movement.

If metadata signing or publishing fails **after creation**, the UI shows the actual market ID and transaction signature. Do not create again. Re-publish the original metadata using the creator wallet, signing UTF-8 bytes of `hunch:market-metadata:v1\n` followed by `JSON.stringify({ marketId, question, outcomes, description? })` in that property order. POST `{ metadata, signature }` to `/v1/metadata`, with the signature base64-encoded. An identical retry is accepted; changed labels are rejected. Verify the creation signature and market account first.

Live resolution still requires the trusted application's public-key registration and the new market's immutable app/event mapping. The browser does not register arbitrary result signers. Developer A must provide the existing protected resolver key and the authorized treasury operator must fund participant TEST accounts and Devnet SOL. Those credentials are not available on this machine. No key was recreated, existing funds moved, real transaction submitted, contract upgrade deployed, or website published for this task. The previously verified missing on-chain deadline guard still requires an approved upgrade; the SDK/resolver enforces correctly timed flows but cannot replace that guard.

## Verification

Tests include independent HTTP sessions sharing a newly created market, finite balances and rejected over-staking, pools `[250, 300]`, signed resolution, replay returning the original receipt, payouts 183 and 366, final balances 1,083 / 1,166 / 750, and double-claim rejection. Catalog tests reject unauthorized signatures and changed outcome labels. These are simulated and mocked-chain integration tests; they are not proof of a real Devnet lifecycle or physical-device access.

A browser run also confirmed a 100-credit Apex stake from the production server and a 50-credit Velocity stake from the Vite server in separate sessions. Both read a 150-credit pool. After the two-minute race deadline, the trusted local game server signed its fixed demonstration result (Apex), the resolver settled it, and the winning browser claimed 150 credits. The claimed portfolio and zero remaining claim were verified. This was a local simulated lifecycle, not a Devnet transaction.

The local shared race is a fixed exhibition fixture: open `/racing`, wait for the two-minute prediction window to close, then start the 12-second race. The winner is fixed by the trusted demo backend, not supplied by the browser. The API must be restarted for a fresh shared fixture; existing browser-local race controls do not reset shared or live markets.

Dependency audit: `npm audit fix` found no compatible automatic fixes. Updating the SDK and resolver test runner to Vitest 5 reduced the audit to 12 advisories (7 moderate, 5 high, zero critical); remaining advisories involve SDK/wallet transitive dependencies. This change does not claim production security clearance; dependency upgrades need compatibility review before public hosting. No forced SDK downgrade was applied.

Final validation: 561 automated tests passed, with one credential-dependent test skipped. All workspace builds pass. Home, discovery, creation, portfolio, help, events, racing and esports were inspected at a 390px viewport without document horizontal overflow. Developer subpages and market links also rendered on desktop. A real second physical device and hosted HTTPS environment were not used. Changes are local and have not been pushed or deployed.

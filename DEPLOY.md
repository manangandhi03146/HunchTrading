# Deploying hunch

The **dashboard app is the whole product** — `/`, `/markets`, `/markets/:id`,
`/portfolio`, `/creators/:creatorId`, `/fortnite`, `/funding`, `/wallet`,
`/racing`, `/esports`, and `/events` are client-side routes inside
`apps/dashboard`. A deployment needs only the dashboard frontend. The resolver is
a separate backend (below).

## Frontend → Vercel

A repo-root [`vercel.json`](vercel.json) is included: it installs the workspace,
runs `npm run build`, serves `apps/dashboard/dist`, and rewrites deep links to
`index.html` for client-side routing.

1. Import the GitHub repo into Vercel. Leave **Root Directory = repository root**
   (the `vercel.json` drives build + output).
2. Set environment variables (Production + Preview):

| Variable | Mock demo | Live Devnet |
|---|---|---|
| `VITE_HUNCH_MODE` | `mock` | `sdk` |
| `VITE_SOLANA_CLUSTER` | `devnet` | `devnet` |
| `VITE_HUNCH_PROGRAM_ID` | — | `J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP` |
| `VITE_TEST_TOKEN_MINT` | — | `9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs` |
| `VITE_RESOLVER_API_URL` | — | `https://<your-resolver-host>` |
| `VITE_HUNCH_MARKET_ID` | optional | a market id that exists on Devnet |

3. Deploy. **Mock mode works standalone** (no backend) — ideal for a first live
   URL. Switch to `sdk` once the resolver is hosted.

Production follows `main`. Pushing a frontend feature branch does not update
the production site: merge its reviewed changes into `main`, then check that
Vercel's production deployment references the resulting merge commit.
Verify `/markets` contains the creator directory and that `/fortnite`,
`/funding`, and `/wallet` load directly after deployment. Without a configured
shared API, ordinary mock markets remain local to each browser; a public URL
alone does not make those markets shared across devices.

> Vercel installs all workspaces, which compiles the resolver's native
> `better-sqlite3`. If that slows the build, it's harmless — the dashboard bundle
> never imports the resolver (it talks to it over HTTP at runtime).

## Resolver → a persistent Node host (not Vercel)

`better-sqlite3` + long-lived replay/registration state mean the resolver belongs
on a persistent Node host (Render / Fly / Railway / a VM), not Vercel serverless.
Live mode: `RESOLVER_MODE=anchor`, `MOCK_HTTP_ENABLED=false`, an absolute
`RESOLVER_KEYPAIR_PATH` (the key Dev A holds, outside git),
`CORS_ALLOWED_ORIGINS=https://<your-vercel-domain>`, and the program/mint/RPC.
Then point `VITE_RESOLVER_API_URL` at its public HTTPS origin. Full startup +
app/market registration steps: [`services/resolver/README.md`](services/resolver/README.md)
and [`docs/full-app-hosting.md`](docs/full-app-hosting.md).

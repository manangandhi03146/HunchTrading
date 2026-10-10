# apps/ — Developer C (Frontend + Demo)

React · Vite · Tailwind

Scaffold each app here with Vite (dirs intentionally left empty to avoid
clobbering the generator):

```bash
# from repo root
npm create vite@latest apps/racing    -- --template react-ts
npm create vite@latest apps/esports   -- --template react-ts
npm create vite@latest apps/dashboard -- --template react-ts
```

Each app consumes the workspace packages:

```ts
import { MarketKit } from "@marketkit/sdk";
// import { PredictionWidget } from "@marketkit/react";  // once built
```

## Tickets (ordered)

| ID | Task | Depends on | Priority |
|----|------|-----------|----------|
| C1 | Scaffold widget + demo apps | — | P0 |
| C2 | Prediction widget on mock data | C1 | P0 |
| C3 | 10-second racing simulation | C1 | P0 |
| C4 | Minimal esports demo | C2 | P1 |
| C5 | Solana wallet + SDK integration | B3 + C2 | P0 |
| C6 | Live market state + claim action | B4/B7 + C5 | P0 |
| C7 | Developer dashboard | C2 | P1 |
| C8 | Demo polish, README images, pitch | C3–C7 | P1 |

**Keep the race trivial** — a 10-second race with an auto-determined winner is
enough. The prediction infra is the product. The race result must come from a
trusted server / server-authorized result — the browser cannot declare its own
winner.

Visual polish (dark-themed MarketKit widget) comes *after* the first working
transaction.

# MarketKit

**Embeddable on-chain prediction markets on Solana.** Any game or app can drop
in a prediction widget; outcomes are settled automatically by a signed event
from the game server, and winners claim their payout directly from an on-chain
escrow vault.

> HackRU 2026 · 24-hour sprint · 3 developers working in parallel.

---

## Locked MVP decisions (§2)

| Decision        | Choice                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| Blockchain      | Solana **Devnet**                                                      |
| Smart contracts | **Anchor**                                                             |
| Assets          | Single custom SPL test-token mint, **zero decimals** (integer amounts) |
| Market type     | **Binary** — outcome 0 or 1                                            |
| Market model    | Pooled stakes, **no trading**                                          |
| Market creation | Authorized developer / resolver                                        |
| Resolution      | Verified game-server event                                             |
| Claiming        | User-triggered transaction                                             |
| Market metadata | Off-chain JSON                                                         |
| Fees            | 0%                                                                     |
| Stack           | TypeScript SDK · React widget · Node.js resolver                       |

**Design note:** registered developers can create markets, but a single
MarketKit-managed **resolver key** submits verified outcomes on-chain. A signed
event from a game server is _evidence accepted by MarketKit_, not direct
authorization to move escrowed funds.

---

## Repo structure

```
.
├── programs/            # Developer A — Anchor smart contract (Rust)
├── packages/
│   ├── sdk/             # Developer B — @marketkit/sdk (TypeScript client)
│   └── react/           # Developer C — @marketkit/react (embeddable widget)
├── services/
│   └── resolver/        # Developer B — signed-event API + on-chain resolver
├── apps/                # Developer C — racing / esports / dashboard demos
└── tests/               # cross-package end-to-end (Create→Stake→Resolve→Claim)
```

npm workspaces tie `packages/*`, `services/*`, and `apps/*` together. See the
`README.md` inside `programs/` and `apps/` for per-role setup commands.

## Quick start

Use Node 22.12+ (22 LTS), 24 LTS, or 26+ and npm 10+.

```bash
npm install
npm run dev         # racing demo: http://127.0.0.1:5173
# In separate terminals:
npm run esports     # esports demo: http://127.0.0.1:5174
npm run dashboard   # developer console: http://127.0.0.1:5175

npm test            # widget, adapter, and SDK regression tests
npm run build       # type-check and build every workspace
```

The frontend is branded **hunch**; package names remain `@marketkit/*`.
All three apps default to local simulation. Connect a demo account, commit
nonredeemable TEST credits, close a race's prediction window, run the race,
and claim the simulated result. See [apps/README.md](apps/README.md) for details.

All app headers include a persistent Light/Dark switch. The complete frontend
handoff, theme architecture, and remaining A/B integration requirements are in
[DEVELOPER_C_HANDOFF.md](DEVELOPER_C_HANDOFF.md).

**Current implementation:** the widgets and demos work locally; live on-chain
settlement is not implemented yet. The `programs/` directory is a scaffold,
the SDK's live methods fail with explicit integration errors, and the resolver
rejects unverified events. Switching to SDK mode requires the deployed Anchor
program, test-token mint, wallet bindings, and a trusted resolver. Simulated
receipts are always labeled and never linked as real blockchain transactions.

`npm run sdk` builds the SDK; `npm run resolver` starts the resolver scaffold
on port 8787. The SDK also provides `new MarketKit({ mock: true })` for
standalone integration tests. Browser demo state is stored per origin, so the
apps on ports 5173, 5174, and 5175 have independent simulated accounts and markets.

---

## Ownership & branches

| Dev                  | Owns                         | Branch                 |
| -------------------- | ---------------------------- | ---------------------- |
| A — Blockchain       | `programs/`                  | `feat/anchor-contract` |
| B — SDK + Automation | `packages/sdk/`, `services/` | `feat/sdk-resolver`    |
| C — Frontend + Demo  | `packages/react/`, `apps/`   | `feat/widget-demos`    |

The shared contract interface lives in
[`packages/sdk/src/types.ts`](packages/sdk/src/types.ts). **Changes to it are
agreed by the team before merging.**

## Milestones

- **M1 · hour 6 — Go/No-Go:** Anchor builds & tests locally · a binary market
  initializes · a vault receives a stake · SDK mock works · widget renders.
- **M2 · hour 12 — End-to-end:** one full `Create → Stake → Resolve → Claim`
  runs on Devnet, ideally through the SDK. _If not working, freeze dashboard +
  second app and move everyone to the broken path._
- **M3 · hour 19 — Demo ready:** live race auto-settles a market, winner claims.
  After this, no new features — only reliability + presentation.

## Two rules

1. **Build the real infrastructure first** — funds must move through the
   contract and return to the correct wallet before any dashboard polish.
2. **Protect the final 5 hours** for testing, demo rehearsal, and submission.

Priority order: **working Solana settlement → automatic event resolution →
reusable SDK → embeddable widget → second app → dashboard polish.**

The fallback is never to fake transactions. A genuinely working, narrower
on-chain product beats a beautiful mock that claims to settle on-chain.

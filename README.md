# MarketKit

**Embeddable on-chain prediction markets on Solana.** Any game or app can drop
in a prediction widget; outcomes are settled automatically by a signed event
from the game server, and winners claim their payout directly from an on-chain
escrow vault.

> HackRU 2026 · 24-hour sprint · 3 developers working in parallel.

---

## Locked MVP decisions (§2)

| Decision | Choice |
|---|---|
| Blockchain | Solana **Devnet** |
| Smart contracts | **Anchor** |
| Assets | Single custom SPL test-token mint, **zero decimals** (integer amounts) |
| Market type | **Binary** — outcome 0 or 1 |
| Market model | Pooled stakes, **no trading** |
| Market creation | Authorized developer / resolver |
| Resolution | Verified game-server event |
| Claiming | User-triggered transaction |
| Market metadata | Off-chain JSON |
| Fees | 0% |
| Stack | TypeScript SDK · React widget · Node.js resolver |

**Design note:** registered developers can create markets, but a single
MarketKit-managed **resolver key** submits verified outcomes on-chain. A signed
event from a game server is *evidence accepted by MarketKit*, not direct
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

```bash
# Developer B & C — no Anchor needed to start (work against the SDK mock)
npm install
npm run sdk          # build @marketkit/sdk
npm run resolver     # run the resolver dev server (:8787)

# Developer A — install the Solana toolchain (see programs/README.md)
```

The SDK ships a mock (`new MarketKit({ mock: true })`) so B and C build against
the real interface before the contract exists. Flip `mock: false` after IDL
integration (ticket B4). **Once integrated, the SDK returns real transaction
signatures, never simulated ids.**

---

## Live deployment

The `marketkit` program is deployed and verifiable on **Solana Devnet**:

| | |
|---|---|
| Program ID | `J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP` |
| Cluster | Devnet — RPC `https://api.devnet.solana.com` |
| Explorer | https://explorer.solana.com/address/J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP?cluster=devnet |

Client IDL + types: [`packages/sdk/src/idl/`](packages/sdk/src/idl/). For local
dev, run `solana-test-validator` and `anchor deploy --provider.cluster localnet`.

---

## Ownership & branches

| Dev | Owns | Branch |
|---|---|---|
| A — Blockchain | `programs/` | `feat/anchor-contract` |
| B — SDK + Automation | `packages/sdk/`, `services/` | `feat/sdk-resolver` |
| C — Frontend + Demo | `packages/react/`, `apps/` | `feat/widget-demos` |

The shared contract interface lives in
[`packages/sdk/src/types.ts`](packages/sdk/src/types.ts). **Changes to it are
agreed by the team before merging.**

## Milestones

- **M1 · hour 6 — Go/No-Go:** Anchor builds & tests locally · a binary market
  initializes · a vault receives a stake · SDK mock works · widget renders.
- **M2 · hour 12 — End-to-end:** one full `Create → Stake → Resolve → Claim`
  runs on Devnet, ideally through the SDK. *If not working, freeze dashboard +
  second app and move everyone to the broken path.*
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

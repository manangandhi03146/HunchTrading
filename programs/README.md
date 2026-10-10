# programs/ — Developer A (Blockchain)

Rust · Anchor · Solana · **critical path**

## Setup (ticket A1)

```bash
# Install Solana development tools (Rust, Solana CLI, Anchor, Node, Yarn)
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash

# Restart terminal, then verify
rustc --version && solana --version && anchor --version
```

## Initialize the Anchor program _inside this monorepo_

`anchor init` wants to create its own folder. Scaffold it in a temp dir and
move the program here so it lives under `programs/hunch/`:

```bash
# from repo root
anchor init hunch
# move the program crate in and keep the root Anchor.toml at repo root
mv hunch/programs/hunch programs/hunch
mv hunch/Anchor.toml ./Anchor.toml   # adjust [programs] paths
# (keep hunch/tests as a reference, then delete the scaffold directory)
anchor build && anchor test
```

Point `Anchor.toml` tests/paths at the monorepo layout, then confirm
`anchor build` + `anchor test` pass before writing instructions.

## Account design (plan §3)

```
Market PDA   seeds: ["market", authority, market_id]
  authority, resolver, token_mint, deadline,
  pool_0, pool_1, winning_outcome, status, bump

Position PDA seeds: ["position", market, wallet, outcome]
  wallet, market, outcome, amount, claimed

Vault Token Account  authority: Market PDA   mint: test-token mint
```

- `market_id` is a fixed-size unique id (e.g. 32 bytes), not an unbounded string.
- One test-token mint with **zero decimals** → all amounts are integers.

## Tickets (ordered)

| ID  | Task                                   | Priority |
| --- | -------------------------------------- | -------- |
| A1  | Install toolchain + run starter test   | P0       |
| A2  | `Market` + `Position` accounts         | P0       |
| A3  | `create_market`                        | P0       |
| A4  | Test-token escrow + `place_prediction` | P0       |
| A5  | `resolve_market`                       | P0       |
| A6  | `claim_winnings`                       | P0       |
| A7  | Integration tests + Devnet deploy      | P0       |
| A8  | Cancellation / refunds                 | P1       |

**`claim_winnings` must:** prevent double claims, require the winning position,
use checked arithmetic, and transfer via the Market PDA's signing authority.
Payouts are proportional integer math; **rounding dust stays in the vault** and
must never let anyone withdraw tokens owed to an unclaimed winner.

Docs: Anchor local dev → https://www.anchor-lang.com/docs/quickstart/local ·
PDA token accounts → https://www.anchor-lang.com/docs/tokens/basics/create-token-account

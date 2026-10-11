# @hunch/sdk

Strict TypeScript SDK for binary pooled-stake markets. The complete mock is working;
real Solana reads and wallet-signed Devnet creation/predictions use the committed IDL.
Wallet-signed claims and server-side authorized resolution are implemented.
Requires Node 22+ for this repository's tooling; the SDK mock has no SQLite or server imports.

From the repository root:

```sh
npm install
npm run sdk
npm test
npm run demo
```

The demo covers racing and esports using genuine Ed25519 signatures and a real
localhost Fastify HTTP server. Token accounting and transaction receipts are mock.
It also runs two independent HTTP SDK clients against one authoritative backend.

## Separate frontend and backend

Run `npm run resolver`, register the applications' signing public keys using the
resolver CLI, and initialize each frontend once:

```ts
import { Hunch, HttpMockMarketAdapter } from '@hunch/sdk';

const adapter = await HttpMockMarketAdapter.connect({
  baseUrl: 'http://127.0.0.1:8787',
  appId: 'racing-demo', // Use 'esports-demo' for the other application.
  label: 'Simulated player Alice',
});
const sdk = new Hunch({ adapter, wallet: adapter.wallet });
await sdk.createMarket({
  id: 'race-42', question: 'Who wins?', outcomes: ['Driver A', 'Driver B'],
  closesAt: Math.floor(Date.now() / 1000) + 60,
});
await sdk.predict({ marketId: 'race-42', outcome: 0, amount: 40n });
const markets = await sdk.listMarkets(); // Same ledger for both applications.
const positions = await sdk.getPositions('race-42'); // This simulated player.
// After the trusted game backend submits the signed 'race-42-finished' event:
const { payout } = await sdk.claimWinnings('race-42');
```

Only the resolver owns market state. The HTTP adapter converts known amount fields
between decimal strings on the wire and `bigint` in SDK results. It cannot call
`resolveMarket`; settlement still requires `/v1/events` with the registered app's
signature. Creation uses the trusted server creator and automatically registers
`<marketId>-finished` for the configured app.

Sessions are explicitly simulated and server-issued. They do not authenticate a
connected Solana wallet. Do not replace `adapter.wallet` with an arbitrary address.
Keep one adapter/session per simulated player; `adapter.session` can be reused via
the `session` option after a frontend reload. Sessions are invalid after backend
restart. Default origins allow localhost/127.0.0.1 ports 5173, 3000 and 4173; other
frontend origins require `MOCK_ALLOWED_ORIGINS` configuration.

Read-only clients can use `new Hunch({ adapter: new HttpMockMarketAdapter({ baseUrl }) })`.
For explicitly enabled token-based demo access, also set `accessToken` on each
adapter. This is a demo admission credential, not a game or resolver private key.
There are no automatic mutation retries after an uncertain network response.

## Mock use

```ts
import { PublicKey } from '@solana/web3.js';
import { Hunch, MockMarketAdapter, createMockWallet } from '@hunch/sdk';

let now = Math.floor(Date.now() / 1000);
const creator = createMockWallet(new PublicKey(new Uint8Array(32).fill(1)));
const resolver = createMockWallet(new PublicKey(new Uint8Array(32).fill(2)));
const adapter = new MockMarketAdapter({
  authorizedCreators: [creator.publicKey.toBase58()],
  resolverAuthority: resolver.publicKey.toBase58(),
  clock: () => now,
});
const sdk = new Hunch({ adapter, wallet: creator });
const backend = new Hunch({ adapter, wallet: resolver });
const { market } = await sdk.createMarket({
  id: 'race-42', question: 'Who wins?', outcomes: ['Driver A', 'Driver B'],
  closesAt: now + 60,
});
await sdk.predict({ marketId: market.id, outcome: 0, amount: 40n });
now += 60;
// Production backend resolution goes through signed-event verification first.
await backend.resolveMarket(market.id, 0);
const claim = await sdk.claimWinnings(market.id);
console.log(claim.payout.toString(), claim.transaction); // mock receipt, signature: null
```

Use one shared adapter with different wallet identities for multiple users. An injected
adapter without a wallet is read-only. Mock wallets identify actors; they cannot sign
Solana transactions and do not simulate wallet token balances.

## Public API

| Method | Result |
| --- | --- |
| `createMarket(params)` | `{ market, transaction, signature, marketSeed? }` |
| `getMarket(id)` | `Market` or `null` |
| `listMarkets({ authority?, status? })` | `Market[]` |
| `predict({ marketId, outcome, amount })` | `{ position, transaction, signature }` |
| `getPositions(marketId, wallet?)` | `Position[]`; defaults to configured wallet; Anchor reads require a public wallet address |
| `claimWinnings(marketId)` | `{ payout, transaction, signature }` |
| `getTransactionStatus(transaction.id)` | receipt status or `not_found` |
| `resolveMarket(id, outcome)` | backend-only operation; requires designated resolver |

All amounts are `bigint` base units. `market.metadata` contains off-chain labels and
question; authority, pools, deadline and status belong to `MarketState`. Legacy
`market.question`/`market.outcomes` aliases are supplied by the mock. `open` and
`closed` derive from time; `resolved` is recorded. At the deadline betting is closed.
Payout is `position.amount * totalPool / winningPool`, rounded down. Dust remains
unallocated; an outcome without stakes has no claimants. Unknown markets and
invalid operations produce `HunchError` with a stable `code`.

Mutation results discriminate `transaction.mode`. Mock IDs start with `mock:` and
`signature` is always `null`; never send them to a block explorer or RPC. Format
bigints with `.toString()` before serializing to JSON.

## Developer C compatibility

Existing `import { MarketKit } from '@marketkit/sdk'` and `new MarketKit({ mock: true })`
continue working through the `packages/marketkit-sdk` compatibility workspace. New imports should use
`@hunch/sdk` and `Hunch`. The resolver uses the same implementation.

The compatibility workspace preserves the existing `MarketKit` class and types
unchanged, including its isolated legacy mock and `MOCK_SIGNATURE` placeholder.
Use `Hunch` with `HttpMockMarketAdapter` for a shared backend; the legacy class
does not accept an adapter. Hunch claims and predictions reject invalid
operations; catch `HunchError` in the widget. Hunch mock signatures are `null`.
Use `HttpMockMarketAdapter` for separately running applications. The older
in-memory `MockMarketAdapter` remains available for unit tests and embedded demos.
HTTP exports are also available through `@marketkit/sdk`; no import migration is required.

## Real integration

`Hunch` supports wallet-free `getMarket` and `listMarkets` in Anchor mode:

```ts
import { Hunch } from '@hunch/sdk';

const sdk = new Hunch({ mode: 'anchor' });
const markets = await sdk.listMarkets();
const closedMarkets = await sdk.listMarkets({ status: 'closed' });
if (markets[0]) {
  const market = await sdk.getMarket(markets[0].id); // Market PDA base58 address
  console.log(market?.totalPool.toString());
}
```

Defaults are Devnet RPC and program
`J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP`. Optional `rpcUrl`, `programId`,
or a web3.js `connection` configure reads; `connection` takes precedence over
`rpcUrl`. Reads use `confirmed` commitment. `new Hunch({ mock: false })` selects
this same adapter; the separate legacy `MarketKit` implementation is unchanged.

Real IDs are Market PDA addresses, not frontend slugs or the raw 32-byte seed.
The adapter validates owner, size, IDL discriminator, PDA seeds/bump, and decoded
state. Missing accounts return `null`; invalid accounts fail with
`INVALID_RESPONSE`; RPC failures produce `NETWORK_ERROR`. Listing uses program
ownership, account size/discriminator filters, and optional creator `authority`
and SDK `status` filters. It does not imply that every listed creator is trusted.

Pools and totals are bigint. Active markets become closed exactly at the deadline
using the local Unix-seconds clock; resolved/cancelled states remain unchanged.
Unrepresentable deadlines are rejected rather than rounded. Metadata is `null`,
with no invented question/outcome labels; hydrate optional display metadata in
the application using the PDA as its key, separately from financial state.

Market reads use no wallet or transactions. `getTransactionStatus(signature)`
reads a real signature's status (with history) for reconciliation, and
`resolveMarket` is a trusted-server operation (see below).

### Wallet-signed Devnet creation

Use `Hunch` with your existing React wallet provider's `publicKey` and
`signTransaction`. Call this from a user action after connecting the wallet:

```ts
import { Hunch, generateMarketSeed, deriveMarketPda } from '@hunch/sdk';

// `wallet` is the existing useWallet() result. No private key leaves the wallet.
if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Connect a signing wallet');
const sdk = new Hunch({
  mode: 'anchor',
  rpcUrl: 'https://api.devnet.solana.com',
  wallet: { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction },
  tokenMint: '9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs',
  resolverAuthority: '6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt',
});
const marketSeed = generateMarketSeed(); // 32 public bytes, not a private key.
const { address } = deriveMarketPda(wallet.publicKey, marketSeed);
const closesAt = Math.floor(Date.now() / 1000) + 3600;
// Save these BEFORE asking the wallet to sign, so timeouts are reproducible.
localStorage.setItem(`hunch:create:${address.toBase58()}`, JSON.stringify({
  marketId: address.toBase58(), marketSeed: Array.from(marketSeed), closesAt,
}));
const result = await sdk.createMarket({
  marketSeed, closesAt, question: 'Who wins?', outcomes: ['Driver A', 'Driver B'],
});
console.log(result.signature, result.market.id); // Genuine signature and Market PDA.
const onChain = await sdk.getMarket(result.market.id);
console.log(onChain?.pools.map(pool => pool.toString()));
// Reproduce the same PDA later without signing or creating again:
const saved = JSON.parse(localStorage.getItem(`hunch:create:${result.market.id}`)!);
const reproduced = deriveMarketPda(wallet.publicKey, Uint8Array.from(saved.marketSeed));
console.log(reproduced.address.toBase58());
```

The defaults are the deployed program and approved mint/resolver shown above.
Explicit `tokenMint` and `resolverAuthority` public keys override those defaults;
a per-market `resolverAuthority` overrides the configured resolver. Creation
checks the actual RPC genesis hash against Devnet before requesting a signature,
including when using an injected `connection`. Mainnet and Testnet are rejected;
there is no mock fallback. The mint must exist, be initialized, and belong to the
classic SPL token program. The approved mint has zero decimals; amounts are base
units. The resolver must be a public key capable of signing; creation does not
require the resolver's private key or a funded resolver account.

PDA derivation is `[UTF8('market'), creator.toBytes(), marketSeed]` under the
configured program ID. Seeds are exactly 32 bytes; the SDK copies supplied seeds
before awaiting RPC. If omitted, the SDK generates one securely and returns it
as `result.marketSeed`. Reads also expose `market.marketSeed`. Always supply and
save a seed yourself when you need recovery after a rejected or uncertain call.
`params.id` is optional in real mode and must equal the derived PDA if provided;
frontend slugs are for mock mode. `closesAt` is future safe integer Unix seconds.

The creator pays Market rent and the transaction fee in Devnet SOL. The SDK
checks rent/fee estimates and balance, builds `create_market` from the actual
IDL with `authority`, `market`, and `system_program`, requests one wallet
signature, and submits once with RPC preflight enabled. It confirms using the
blockhash and last valid block height, then immediately calls `getMarket()` and
verifies creator, seed, deadline, mint and resolver. A confirmed result includes
the actual signature as both `signature` and `transaction.id`. Questions and
labels exist only in the returned `market.metadata`; later reads return `null`.
Persist display metadata separately by PDA. Creation does not initialize a vault
or transfer test tokens; the vault is created on the first prediction.

Handle `HunchError.code`:

- `USER_REJECTED`, `INVALID_SIGNER`, `INVALID_DEADLINE`, `CONFIGURATION_ERROR`,
  `INSUFFICIENT_FUNDS`, `MARKET_EXISTS`: fix the input, wallet or funding problem.
- `NETWORK_ERROR`: preparation failed before submission.
- `TRANSACTION_FAILED`: RPC preflight or confirmed execution failed.
- `TRANSACTION_UNCERTAIN`: submission/confirmation could not be determined.
  Check `error.details.signature` using RPC `getSignatureStatuses` and read
  `error.details.marketId` before considering another attempt. No automatic
  mutation retries or recovery are implemented.
- `INVALID_RESPONSE` with `details.confirmationStatus === 'confirmed'`:
  the transaction confirmed but state verification failed. Keep the signature
  and inspect the PDA; do not blindly create again.

Preparation, signing, submission, confirmation and verification errors include
the PDA and public seed hex in `details`.
Disable duplicate pending UI actions and retain these details on uncertain calls.

### Opt-in real creation script

Ordinary tests and `npm run demo` never submit blockchain transactions. To
deliberately authorize one creation, supply your own funded Devnet keypair file
locally (Solana CLI JSON, never sent to a backend):

First preview without authorizing:

```sh
npm run create:devnet --workspace @hunch/sdk -- \
  --keypair /absolute/path/to/funded-devnet-wallet.json
```

This prints the creator, random 32-byte seed, derived PDA, future deadline,
approved program/mint/resolver, and off-chain labels, then exits successfully
without RPC, signing or submission. It prints an authorization command that
reuses that exact seed and deadline. Review the preview and deliberately run
that command when ready. Preserve any custom `--rpc` setting yourself; provider
credentials are omitted from output. Previewing alone does not verify funding
or prove that the PDA is unused. Authorized SDK preflight checks the actual
Devnet cluster, mint, account absence, rent/fee estimate and wallet balance.

For an explicitly selected seed and deadline, the authorized command is:

```sh
npm run create:devnet --workspace @hunch/sdk -- \
  --authorize-devnet-create --keypair /absolute/path/to/funded-devnet-wallet.json \
  --seed 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f \
  --closes-at <future-Unix-seconds>
```

Submission requires both authorization and an explicit keypair path. Optional `--rpc`
or `SOLANA_RPC_URL` chooses a Devnet RPC; the genesis guard still applies.
Omitting `--seed` uses secure generation; omitting `--closes-at` uses one hour
from invocation. The script prints the public creator, seed, PDA and deadline
before signing, and prints the signature only after confirmation and state
verification. It never prints private material, generates keys, requests
airdrops, deploys programs, or retries a mutation. Reusing the creator/seed
after successful creation correctly fails with `MARKET_EXISTS`.

If there is no local wallet and no Solana CLI installed, this optional command
creates a fresh Devnet-only wallet outside the repository, refuses to overwrite
an existing file, and prints only its public address. Run it yourself when
setting up the wallet; the creation script never generates one automatically.

```sh
node --input-type=module <<'NODE'
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
const directory = join(homedir(), '.config', 'solana');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const file = join(directory, 'hunch-devnet-creator.json');
const wallet = Keypair.generate();
writeFileSync(file, JSON.stringify(Array.from(wallet.secretKey)), { flag: 'wx', mode: 0o600 });
console.log('Wallet file:', file);
console.log('Public address:', wallet.publicKey.toBase58());
NODE
```

Fund the printed public address with Devnet SOL using the
[Solana Foundation Devnet faucet](https://faucet.solana.com/). A small buffer such
as 0.01 Devnet SOL covers a single Market's current rent and fee; SDK preflight
uses the current RPC estimates. No test-token balance is needed for creation.
Preview with `--keypair "$HOME/.config/solana/hunch-devnet-creator.json"`, then
review and deliberately invoke the printed authorization command. Never place
the wallet file in git or export a browser wallet's private key for this script.

Run the opt-in read-only network check:

```sh
npm run smoke:devnet --workspace @hunch/sdk
```

It verifies the Devnet genesis hash and executable program, lists markets, and
reads up to five existing markets by PDA. With no accounts it reports an empty
list and successful program connectivity. `SOLANA_RPC_URL` can select another
Devnet RPC. This is not a transaction lifecycle test.

Cancellation/refunds, balances, fees, and trading are outside the mock MVP.
See [handoff notes](HANDOFF.md) and the [resolver README](../../services/resolver/README.md).

### Wallet-signed Devnet staking and position reads

The existing `predict()` API now builds the actual `place_prediction(u8, u64)`
instruction. Use the same browser wallet signer as creation; no private keys go
to the SDK backend. Call from a user action and disable repeated pending actions:

```ts
import { Hunch, derivePositionPda, deriveVaultPda } from '@hunch/sdk';
import { PublicKey } from '@solana/web3.js';

// `wallet` comes from the application's existing useWallet() provider.
if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Connect a signing wallet');
const sdk = new Hunch({
  mode: 'anchor',
  rpcUrl: 'https://api.devnet.solana.com',
  wallet: { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction },
  tokenMint: '9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs',
});
const marketId = '9xkdZGMXWEeGNCmwtN3rKra5gvPNNQotk7sUhxhEvCQm';
const market = await sdk.getMarket(marketId);
if (!market || market.status !== 'open') throw new Error('Choose an open market');
const outcome = 0;
const positionPda = derivePositionPda(new PublicKey(marketId), wallet.publicKey, outcome);
const vaultPda = deriveVaultPda(new PublicKey(marketId));
console.log(positionPda.address.toBase58(), vaultPda.address.toBase58());
const receipt = await sdk.predict({ marketId, outcome, amount: 1n });
console.log(receipt.signature, receipt.position.amount.toString()); // Aggregate stake.
console.log(receipt.verification!.market.pools.map(pool => pool.toString()));
console.log(receipt.verification!.vaultBalance.toString());
const positions = await sdk.getPositions(marketId); // Connected wallet; no signature.
// A read-only SDK can also inspect a public wallet explicitly:
const reader = new Hunch({ mode: 'anchor' });
await reader.getPositions(marketId, wallet.publicKey.toBase58());
```

Amounts are **base units**, positive bigint, at most `2^64 - 1`. The approved
TEST mint has zero decimals, so `1n` stakes one TEST. SDK checks prevent overflow
of the aggregate position, total pool (required by contract payout arithmetic),
and vault. Market mint must match configured `tokenMint`. Active markets close
at `now >= deadline`; resolved/cancelled markets cannot accept predictions.
Writes verify the RPC's Devnet genesis hash before requesting a signature.

Position seeds are `[UTF8('position'), market bytes, wallet bytes, outcome byte]`;
vault seeds are `[UTF8('vault'), market bytes]`. The vault's **token authority is
the Market PDA**, not the vault address. `accountsStrict` supplies the actual
IDL accounts: `user`, `market`, `tokenMint`, `vault`, `userTokenAccount`, `position`,
`tokenProgram`, `systemProgram`. The contract initializes absent vault/position
accounts on the first stake and accumulates subsequent stakes. SOL preflight
includes fees and rent only for accounts needing creation.

The SDK uses the wallet's associated token account when present. If absent, it
selects a deterministic existing wallet-owned account of the market mint with
enough TEST. An existing ATA with insufficient funds is rejected; explicitly
select another account with `tokenAccount: 'PUBLIC_TOKEN_ACCOUNT_ADDRESS'`.
Every selected account must belong to the classic SPL token program, match the
wallet owner and mint, be initialized/unfrozen, and have sufficient tokens.

To create a missing ATA, pass `createAssociatedTokenAccount: true`. The wallet
must already own a separate funded account. One transaction creates the ATA
idempotently, transfers exactly the stake from that account with a checked SPL
transfer, and stakes from the ATA. All instructions use the same wallet approval
and revert together if the stake fails. This option cannot be combined with an
explicit `tokenAccount`. Creating an empty ATA does not supply TEST: with no
funded source, the SDK stops before signing. It never mints or requests airdrops.
Balances spread across several individually insufficient accounts are not merged.

After confirmation the SDK reads Market, Position and vault in one snapshot at
or after the confirmation slot. It validates the Position's owner, discriminator,
size, stored market/wallet/outcome/bump, and verifies at least the requested
increase in position, selected outcome pool, and vault balance. Concurrent
additional stakes are allowed. A concurrent resolution/claim can drain the vault
before the read; verification then reports `INVALID_RESPONSE` with the confirmed
signature and `confirmationStatus: 'confirmed'`. Do not blindly repeat a stake.
RPC submission/confirmation timeouts return `TRANSACTION_UNCERTAIN` with the
locally derived genuine signature; no automatic resubmission or mock fallback.
Wallet rejection, invalid signer, insufficient TEST/SOL, closed markets, simulation
rejection and on-chain failures have explicit `HunchError` codes.

`getPositions(marketId, wallet?)` reads the two derived PDAs in the same snapshot
as the market and omits absent positions. An absent market is `MARKET_NOT_FOUND`;
a read-only client omitting a wallet is `WALLET_REQUIRED`. The optional `id` is
the Position PDA, `amount` is the accumulated stake, and `claimed` is on-chain.
For a resolved winning position, `payout` is the integer proportional share
computed from on-chain pools, including when already claimed; it is not a
separately stored historical transfer amount. Non-winning/unresolved payout is
`0n`. Real resolution and the transaction-status API remain unsupported.

### Opt-in first live stake

A read-only check on October 10, 2026 verified the market above, approved mint,
and public staking wallet `4AM4GTTjuqSrmsLiSzjgXAUpb62nY2qcReKtQJ9N842S`.
The wallet had **498,511,640 lamports and no TEST accounts**. The mint authority
is `FndLN9xiWLBa2CMMjRA4X5DwU5VZwQzaTuoF43kuMM6D`; its token account
`7mRZVNDvywk9DHtbvEsBP2KMGdPKLQW383RWt2k9p1VM` held all 1,000,000 TEST.
Ask that authority's operator to transfer a small TEST amount to the staking
wallet's associated token account
`EcZwQEnU5n7QnG1RfbF9ys9dkTQw8TXims7FcEjq6MaT`
(or another account owned by the wallet). The authority operator can create this
ATA while transferring; no user private key is needed for receiving tokens.
Alternatively the actual mint authority can deliberately authorize minting.
Possessing SOL or the market creator key does not grant mint authority. This
implementation reads no authority keys and submits no token funding transaction.

The existing market deadline is Unix `1791669869` (October 10, 2026, 22:04:29 UTC).
If it has elapsed, deliberately create a fresh market with a future deadline
using the existing creation script and replace `--market` below.

Preview requires **only a public address**; it reads public state and prints the
PDAs, mint authority, amount, deadline, SOL/token balances and funding prerequisites.
It never reads a private key without `--authorize-devnet-stake`:

```sh
npm run stake:devnet --workspace @hunch/sdk -- \
  --wallet 4AM4GTTjuqSrmsLiSzjgXAUpb62nY2qcReKtQJ9N842S \
  --market 9xkdZGMXWEeGNCmwtN3rKra5gvPNNQotk7sUhxhEvCQm \
  --outcome 0 --amount 1
```

After obtaining TEST and reviewing the preview, deliberately authorize one stake:

```sh
npm run stake:devnet --workspace @hunch/sdk -- \
  --authorize-devnet-stake \
  --keypair "$HOME/.config/solana/hunch-devnet-creator.json" \
  --wallet 4AM4GTTjuqSrmsLiSzjgXAUpb62nY2qcReKtQJ9N842S \
  --market 9xkdZGMXWEeGNCmwtN3rKra5gvPNNQotk7sUhxhEvCQm \
  --outcome 0 --amount 1
```

The script prints the preview before reading the explicitly supplied local key
and verifies its public address matches `--wallet`. It blocks missing TEST and
closed markets before key access; the SDK checks rent/fees and network again.
`--token-account ADDRESS`, `--create-ata`, and `--rpc URL` are optional; credentials
are omitted from output. Keep the key outside the repository. An authorized run
returns a genuine signature, verified position, outcome pools and vault balance.
Ordinary builds, tests, mock demos and read smoke checks never invoke live staking.
No live stake was submitted during this implementation; transaction validation
is pending TEST funding and a deliberate authorized invocation.

### Wallet-signed claims

`claimWinnings(marketId, options?)` builds the actual `claim_winnings` instruction
(no arguments) with the exact IDL accounts: `user` (signer, writable), `market`,
`tokenMint`, `vault` (writable), `position` (writable), `userTokenAccount`
(writable), `tokenProgram`. The connected wallet signs; reuse the wallet
configuration from the staking example:

```ts
const market = await sdk.getMarket(marketId);
if (market?.status !== 'resolved') throw new Error('Wait for on-chain resolution');
const [mine] = (await sdk.getPositions(marketId)).filter(p => p.outcome === market.winningOutcome);
if (!mine || mine.claimed) throw new Error('Nothing to claim');
console.log('Expected payout', mine.payout.toString()); // exact bigint preview
const result = await sdk.claimWinnings(marketId);
// Or: sdk.claimWinnings(marketId, { createAssociatedTokenAccount: true })
//     sdk.claimWinnings(marketId, { tokenAccount: 'WALLET_OWNED_TOKEN_ACCOUNT' })
console.log(result.signature, result.payout.toString(), result.position!.claimed);
console.log(result.verification!.tokenAccount, result.verification!.tokenBalance.toString());
```

The SDK derives the Position PDA for the market's **winning outcome** and the
vault PDA, then checks before requesting a signature: Devnet genesis, deployed
program, initialized mint matching the market, `resolved` status (cancelled
markets fail: the contract has no refunds), an existing unclaimed winning
position (`NO_WINNING_POSITION` names the case where only the losing outcome was
backed; `ALREADY_CLAIMED` otherwise), a vault owned by the Market PDA holding at
least the payout, and SOL for fees plus any new ATA rent.

`computeClaimPayout(amount, pools, winningOutcome)` reproduces the contract's
`floor(amount × totalPool ÷ winningPool)` in exact bigint arithmetic. Pools whose
sum exceeds u64 are rejected because the contract's checked addition would abort.
Rounding dust stays in the vault, as in the contract.

Payouts go to the wallet's ATA when it exists. If it is absent, the SDK pays a
deterministic existing unfrozen wallet-owned account of the mint; with none,
it requires a choice: `createAssociatedTokenAccount: true` adds an idempotent ATA
creation to the same transaction (one signature, atomic with the claim), or
`tokenAccount` selects an explicit account. Recipients must be classic SPL accounts
owned by the wallet, of the market mint, initialized and unfrozen.

After confirmation, the SDK reads market, position, vault and recipient at or
after the confirmation slot and requires the position to be `claimed` with its
amount unchanged. It then reads **this transaction's own token-balance metadata**
and requires the vault to have moved exactly `-payout` and the recipient exactly
`+payout`. Current balances alone could include unrelated concurrent transfers.
Metadata reads (not the transaction) are retried briefly if the RPC lags.

Contract errors in RPC simulation or confirmation map to SDK codes when raised by
the Hunch program's own instruction: `AlreadyClaimed` (6007) → `ALREADY_CLAIMED`,
`NotWinningPosition` (6008) → `NO_WINNING_POSITION`, `MarketNotResolved` (6005)
→ `MARKET_NOT_RESOLVED`. Uncertain submission or confirmation returns
`TRANSACTION_UNCERTAIN` with the genuine locally derived signature and expected
payout; a confirmed but unverifiable claim returns `INVALID_RESPONSE` with
`confirmationStatus: 'confirmed'`. Never retry a claim blindly: check the
signature and the position's `claimed` flag first. Mock and HTTP adapters keep
their existing behavior and ignore the options argument.

### Opt-in first live claim

Preview reads only public accounts: market status and winning outcome, the
wallet's positions, the exact expected payout, vault balance, and recipient:

```sh
npm run claim:devnet --workspace @hunch/sdk -- \
  --wallet WINNING_WALLET_PUBLIC_ADDRESS --market MARKET_PDA
```

After reviewing, deliberately authorize one claim:

```sh
npm run claim:devnet --workspace @hunch/sdk -- \
  --authorize-devnet-claim --keypair /path/to/winning-devnet-wallet.json \
  --wallet WINNING_WALLET_PUBLIC_ADDRESS --market MARKET_PDA
```

The key is read only when the preview shows a resolved market, an unclaimed
winning position, a sufficient vault and a usable recipient, and its public
address must equal `--wallet`. Optional: `--create-ata`, `--token-account`,
`--rpc` (credentials are never printed). No live claim was submitted while
implementing this; a real claim needs a staked winning position on a market
the resolver key has resolved on-chain.

### Authorized resolution (trusted server only)

`resolveMarket(marketId, outcome, signer, { onSigned? })` on the Anchor adapter signs
the contract's actual `resolve_market` instruction with the market's resolver key.
It refuses, before any signature request: a signer other than the configured
`resolverAuthority` (prediction wallets cannot resolve), browsers, outcomes other
than 0/1, non-Devnet clusters, missing or corrupt markets, a different stored
resolver or mint, resolved (`MARKET_RESOLVED`) or cancelled markets, and markets
whose deadline has not passed by the local clock **and** the cluster `Clock` sysvar
(`MARKET_NOT_CLOSED`). The deployed program does not check the deadline itself.
The resolver needs Devnet SOL for the fee.

It submits once with preflight and `maxRetries: 0`, confirms, reads the market back
at or after the confirmation slot, and returns `{ mode: 'anchor', signature,
status: 'confirmed' }` only when the market records the requested outcome.
`onSigned` is awaited after signing and before broadcast so a server can persist
the signature and `lastValidBlockHeight`; if it throws, nothing is sent.
`TRANSACTION_UNCERTAIN` details carry `signature`, `blockhash` and
`lastValidBlockHeight`. Never resubmit; reconcile via `getTransactionStatus` and the
market. Settlement for applications goes through the signed-event resolver, which
wires this up. Mock and HTTP adapters keep their existing behavior.

### Opt-in first live resolution

An operator tool for validating the first settlement; production settlement should
use the resolver service. The preview reads only public accounts: status, deadline,
cluster time, pools, and resolver SOL:

```sh
npm run resolve:devnet --workspace @hunch/sdk -- --market MARKET_PDA --outcome 1
```

After review, deliberately authorize one irreversible resolution:

```sh
npm run resolve:devnet --workspace @hunch/sdk -- --authorize-devnet-resolution \
  --market MARKET_PDA --outcome 1 --keypair ~/.config/solana/marketkit-resolver.json
```

The key is read only when the preview shows an eligible market (closed on the cluster
clock, unresolved, approved mint/resolver, funded resolver). The file must be outside
the repository with mode 600, and its public key must be the market's resolver.

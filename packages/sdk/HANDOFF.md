# Developer B handoff

**Current verification handoff:** `feat/devnet-lifecycle` incorporates this SDK
and resolver implementation, adds contract lifecycle coverage, corrects the React
Devnet guard under the user's authorization, and prevents release of uncertain
resolver events from missing RPC history alone. The
[Devnet runbook](../../docs/devnet-lifecycle.md) records exact CI results and the
remaining Developer A resolver-key / authorized treasury blockers. Earlier
implementation-stage notes below do not establish a completed real Devnet run.

## Developer A

Developer A's generated IDL and types now live in `src/idl/`, and the public Devnet
program, mint, and resolver identities are recorded in the root `.env.example`.
The SDK's `AnchorMarketAdapter` now implements read-only `getMarket` and
`listMarkets` using those artifacts. It validates owner, discriminator, layout,
and PDA seeds, returns bigint pools, and derives Active market deadlines. Real
IDs are Market PDA addresses and metadata remains optional/off-chain (`null`
until supplied by the application). Run `npm run smoke:devnet --workspace @hunch/sdk`
to verify Devnet connectivity without a wallet or transaction.

Wallet-signed `createMarket` is implemented from the committed IDL, with Devnet
genesis verification, exact creator/seed PDA derivation, rent/fee checks,
signature verification, RPC confirmation, and post-confirmation state reads.
Defaults use the approved mint `9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs`
and resolver `6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt`.
No Rust or frontend changes were needed. Live creation requires deliberate use
of `npm run create:devnet --workspace @hunch/sdk -- --authorize-devnet-create
--keypair /path/to/funded-devnet-wallet.json`; it is never part of tests/demo.

Before authorizing, run `npm run create:devnet --workspace @hunch/sdk --
--keypair /path/to/funded-devnet-wallet.json` without the authorization flag.
It prints the intended parameters and PDA and a rerun command preserving the
exact public seed/deadline; it performs no signing or RPC. Review that command
before invoking it. A configured, funded local wallet is still required for
live validation. The [SDK README](README.md#opt-in-real-creation-script) includes
local wallet setup instructions for machines without the Solana CLI.

All adapter operations are implemented; resolution is restricted to the trusted
resolver server. Details confirmed against the committed IDL:

- Generated IDL JSON, generated TypeScript types, and Anchor version.
- Deployed program address and cluster/RPC; test SPL mint and decimals.
- Exact market/position PDA seeds, market-ID byte encoding, and vault/ATA rules.
- Instruction names, arguments, account order/flags, and required signers for
  create, predict, resolve, and claim; fetch/list account layouts and errors.
- Deadline rules (our MVP resolves at or after the deadline), resolver authority,
  per-wallet/outcome position accumulation, proportional integer payouts, dust,
  double-claim prevention, and behavior when no one stakes on the winner.

Use the implemented adapter methods for write integration and the opt-in Devnet
lifecycle harness for verification. Do not infer the wire interface from README
sketches. Signed submissions are journaled before broadcast; uncertain recovery
requires reconciliation and never automatically resubmits.

## Developer C

Your files are untouched. Existing `@marketkit/sdk` imports and `MarketKit` class
continue working through the `packages/marketkit-sdk` compatibility workspace. New development can import `Hunch` from
`@hunch/sdk` with the same public methods. Run `npm install` and `npm run build` first.

The compatibility workspace preserves the pre-existing `MarketKit` implementation
and types unchanged. Its legacy in-memory mock is isolated and still returns the
old `MOCK_SIGNATURE` placeholder. Use the exported `Hunch` and
`HttpMockMarketAdapter` for the shared HTTP ledger and explicitly simulated
receipts; the legacy `MarketKit` class does not accept an HTTP adapter.

- For separately running React applications use `HttpMockMarketAdapter`, which
  connects both applications to the resolver's single authoritative mock ledger.
  Do not instantiate a separate in-memory `MockMarketAdapter` in those frontends.
- Read labels from `market.metadata`; format token values with `.toString()`.
- Catch `HunchError.code` for closed markets, invalid amounts, and repeated claims.
- Mock receipts have `mode: 'mock'`, an ID, and `signature: null`. Do not display
  them as blockchain transactions. Real reads and wallet-signed creation work
  through `Hunch`; predictions and wallet-specific position reads now work too.
  Wallet-signed claims work as well. Resolution happens only on the resolver server.
- Use your existing wallet provider's `publicKey` and `signTransaction` for real
  creation and staking. Browser code never receives the game or resolver private key.
- HTTP identities are server-issued and explicitly simulated. They do not prove
  ownership of a Solana wallet. Never substitute a connected real wallet address
  for the HTTP adapter's simulated wallet.

### Start the backend and register game signing keys

Run `npm install`, `npm run build`, and `npm run resolver` from the root. It binds
to `127.0.0.1:8787` by default. Register `racing-demo` and `esports-demo` using each
game server's Ed25519 public key. To generate local demo keys without printing
private material, run this once from the repository root:

```sh
node --input-type=module <<'NODE'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import nacl from 'tweetnacl';
mkdirSync('.keys', { recursive: true });
for (const appId of ['racing-demo', 'esports-demo']) {
  const path = `.keys/${appId}.json`;
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(Array.from(nacl.sign.keyPair().secretKey)), { mode: 0o600 });
  }
  const keys = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
  console.log(`${appId} public key: ${Buffer.from(keys.publicKey).toString('base64')}`);
}
NODE

npm run register --workspace @marketkit/resolver -- \
  --app-id racing-demo --public-key '<printed racing public key>'
npm run register --workspace @marketkit/resolver -- \
  --app-id esports-demo --public-key '<printed esports public key>'
```

Keep these key files in the game backend; `.keys/` is ignored by git. Application
registration uses SQLite and can run while the resolver is listening. Frontends
never receive these keys. HTTP market creation automatically maps the market to
the chosen registered app and authorizes `<marketId>-finished` as its result event.

### Exact frontend initialization

Initialize once per simulated player at app startup, then reuse `sdk` across React
components. Each independent call to `connect` creates a different simulated player.
The racing app uses `appId: 'racing-demo'`; the esports app uses `'esports-demo'`.

```ts
import { Hunch, HttpMockMarketAdapter } from '@hunch/sdk';
// Hunch and HttpMockMarketAdapter are also exported by '@marketkit/sdk'.

const adapter = await HttpMockMarketAdapter.connect({
  baseUrl: 'http://127.0.0.1:8787',
  appId: 'racing-demo',
  label: 'Simulated player Alice',
});
const sdk = new Hunch({ adapter, wallet: adapter.wallet });

const { market } = await sdk.createMarket({
  id: 'race-42', // Use a fresh ID for each game; esports might use 'tournament-final'.
  question: 'Who wins race 42?',
  outcomes: ['Driver A', 'Driver B'],
  closesAt: Math.floor(Date.now() / 1000) + 60,
});
await sdk.predict({ marketId: market.id, outcome: 0, amount: 40n });
const allMarkets = await sdk.listMarkets(); // Includes both apps' markets.
const currentMarket = await sdk.getMarket(market.id);
const myPositions = await sdk.getPositions(market.id);

// After the game backend submits its signed result and status becomes resolved:
const claim = await sdk.claimWinnings(market.id);
console.log(claim.payout.toString());
const receipt = await sdk.getTransactionStatus(claim.transaction.id);
```

Use `Hunch` for these constructor options; the unchanged legacy `MarketKit` class
continues to provide its original isolated mock behavior.
Use `.getMarket()` to poll status; do not call `.resolveMarket()` from the frontend.
The HTTP adapter automatically handles decimal wire amounts and credentials.
Expose a visible "Simulated player / mock tokens" label using `adapter.session`.
`wallet` query parameters only filter reads and are not proof of ownership.

For reloads in the same server session, save `adapter.session` in session storage
and pass it as the `session` option to `connect`. Treat its token as a credential
for that simulated player. Backend restarts invalidate sessions and reset mock
pools/positions. Reconnect and use fresh market IDs; SQLite deliberately retains
old registrations/events and prevents those IDs from being reused.

### Complete automatic settlement

After `closesAt`, the game backend signs and submits a result. For the market above:

```sh
mkdir -p .data
npm run --silent sign-event --workspace @marketkit/resolver -- \
  --keypair-path ../../.keys/racing-demo.json --app-id racing-demo \
  --event-id race-42-finished --market-id race-42 --outcome 0 > .data/event.json
npm run submit-event --workspace @marketkit/resolver -- \
  --event-file ../../.data/event.json --url http://127.0.0.1:8787
```

Use the esports key/app/market for tournament results. Existing signature checks,
deadline checks, replay protection and automatic resolution remain unchanged.

### Browser access and limits

Local development allows `localhost` and `127.0.0.1` frontend origins on ports
5173, 3000 and 4173. Set `MOCK_ALLOWED_ORIGINS` for other exact loopback origins.
Do not bind local access to `0.0.0.0`. An explicitly authenticated remote demo must
use `MOCK_HTTP_ACCESS=token`, a random `MOCK_API_TOKEN` of at least 32 characters,
exact allowed origins, and HTTPS. Supply that demo admission token as `accessToken`
in the adapter options; it is distinct from game/resolver private keys.

No mutation is automatically retried after a network timeout. Check positions and
claim state before retrying; disable duplicate pending actions in the UI. HTTP
market IDs are limited to 119 characters; positive wire stakes to 128 decimal digits.
The mock ledger is single-process and ephemeral; it does not move real tokens.

Root commands: `npm run build`, `npm test`, `npm run demo`, `npm run resolver`.
See the package READMEs for API usage and backend event-signing examples.

### Exact real frontend creation initialization

In a React component, obtain `wallet` from your existing `useWallet()` provider.
Run the following in a user-triggered callback; use the real `Hunch` client
separately from any explicitly simulated HTTP session:

```ts
import { Hunch, generateMarketSeed, deriveMarketPda } from '@hunch/sdk';

if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Connect a wallet that can sign');
const sdk = new Hunch({
  mode: 'anchor', rpcUrl: 'https://api.devnet.solana.com',
  wallet: { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction },
  tokenMint: '9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs',
  resolverAuthority: '6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt',
});
const marketSeed = generateMarketSeed();
const marketId = deriveMarketPda(wallet.publicKey, marketSeed).address.toBase58();
const closesAt = Math.floor(Date.now() / 1000) + 3600;
localStorage.setItem(`hunch:create:${marketId}`, JSON.stringify({
  marketSeed: Array.from(marketSeed), marketId, closesAt,
}));
const created = await sdk.createMarket({
  marketSeed, closesAt, question: 'Who wins?', outcomes: ['Driver A', 'Driver B'],
});
console.log(created.signature, created.market.id);
const realMarket = await sdk.getMarket(created.market.id);
console.log(realMarket?.totalPool.toString());
```

Keep the seed/PDA before wallet approval. Handle `USER_REJECTED`, insufficient
funds and duplicate PDA errors in the UI. For `TRANSACTION_UNCERTAIN`, retain the
signature from `HunchError.details` and inspect RPC signature status and market
state before retrying. An `INVALID_RESPONSE` with confirmed details means the
transaction confirmed but the requested account could not be verified. Disable
duplicate pending actions. No fallback or automatic mutation retry occurs.

PDA seeds are `['market', creator bytes, 32-byte marketSeed]`; real IDs are always
the PDA string. `createMarket` returns both the seed and genuine signature after
confirmation and checking creator, seed, deadline, mint and resolver. Labels in
the creation result are local metadata; save them separately by PDA, since real
reads contain no labels. The default approved mint has zero decimals. Fund the
creator with Devnet SOL for rent and fees; no test tokens are needed for creation.

Wallet-signed `predict()` now invokes the actual `place_prediction(outcome, amount)`
with exact IDL accounts and classic SPL token validation. Wallet-specific
`getPositions()` reads both outcome PDAs with exact bigint values. Reuse the
wallet configuration above and call from a user action:

```ts
const market = await sdk.getMarket(marketId);
if (!market || market.status !== 'open') throw new Error('Choose an open market');
const result = await sdk.predict({ marketId, outcome: 0, amount: 1n });
console.log(result.signature, result.position.id, result.position.amount.toString());
console.log(result.verification!.market.pools.map(pool => pool.toString()));
console.log(result.verification!.vault, result.verification!.vaultBalance.toString());
const positions = await sdk.getPositions(marketId); // Connected wallet.
// Without a signer, supply only the public wallet address:
await new Hunch({ mode: 'anchor' }).getPositions(marketId, wallet.publicKey.toBase58());
```

The SDK automatically chooses an existing ATA, or a funded owned account if the
ATA is absent. `tokenAccount` explicitly chooses another wallet-owned account.
`createAssociatedTokenAccount: true` creates a missing ATA and transfers the stake
from an existing funded owned account before staking, atomically under one wallet
signature. It does not mint. Amounts are bigint base units (TEST has zero decimals).
New vault/position/ATA rent and fees are paid in SOL; TEST pays the stake itself.

Position seeds are `['position', market bytes, wallet bytes, one outcome byte]`;
vault seeds are `['vault', market bytes]`. The Market PDA is the vault token owner.
First stakes initialize accounts; repeats return accumulated positions. Missing
position PDAs return an empty list; malformed/foreign accounts are rejected.
`payout` on real resolved positions is a calculated proportional share, including
claimed positions, since the contract does not store the historical payout.

See [SDK staking usage and opt-in commands](README.md#wallet-signed-devnet-staking-and-position-reads)
for complete React initialization, account selection, errors, and preview/live
commands. Public preview never reads keys; `--authorize-devnet-stake` plus an
explicit matching keypair is required for submission. Retain error signatures
for uncertain or confirmed-but-unverified transactions and do not blindly retry.
A resolution/claim racing the post-confirmation read can invalidate vault balance
verification; real recovery/rebroadcast infrastructure remains deferred.

Read-only Devnet inventory verified wallet
`4AM4GTTjuqSrmsLiSzjgXAUpb62nY2qcReKtQJ9N842S` had 0.498511640 SOL but no TEST.
The approved mint authority `FndLN9xiWLBa2CMMjRA4X5DwU5VZwQzaTuoF43kuMM6D`
holds 1,000,000 TEST in `7mRZVNDvywk9DHtbvEsBP2KMGdPKLQW383RWt2k9p1VM`.
The authority operator must deliberately transfer TEST to the staking wallet,
or authorize minting with the actual mint authority. No authority signing setup
is assumed. No TEST funding or live stake was submitted by this implementation.
The supplied market closes at 2026-10-10 22:04:29 UTC; use a fresh market if expired.

Next tasks are the first authorized TEST-funded live stake, then provisioning the
resolver key to the server (`RESOLVER_MODE=anchor`). Signed-event mock settlement and
existing HTTP/mock compatibility remain functional. Frontend files were not changed.

### Wallet-signed claims

`sdk.claimWinnings(marketId, options?)` now invokes the actual `claim_winnings`
instruction for the connected wallet's winning-outcome position. Gate the claim
button on `market.status === 'resolved'` and an unclaimed position whose
`outcome === market.winningOutcome`; that position's `payout` is the exact bigint
amount the contract will pay. Options: `{ createAssociatedTokenAccount: true }`
creates a missing ATA atomically in the same signature; `{ tokenAccount }` selects
an explicit wallet-owned account. Without either, an existing ATA (or a usable
owned account) receives the payout.

Handle `MARKET_NOT_RESOLVED`, `NO_WINNING_POSITION`, `ALREADY_CLAIMED`,
`USER_REJECTED` and `INSUFFICIENT_FUNDS` in the UI. On `TRANSACTION_UNCERTAIN`
keep `error.details.signature` and re-read positions before allowing a retry.
Successful results return the genuine signature, the claimed position, and
verified balances; the token movement is checked against the transaction's own
metadata. See [SDK claim usage](README.md#wallet-signed-claims) and the opt-in
`npm run claim:devnet` preview/authorize flow.

First live claim prerequisites: a TEST-funded live stake on the winning side,
the market's deadline passed, and the resolver key
`6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt` resolving the market on-chain
(signed event through the real-mode resolver, or `npm run resolve:devnet`).
That key is held by Developer A. No claim was submitted during implementation.

### Real resolution and the signed-event backend

Frontends never resolve. Poll `getMarket()` (or `GET /v1/events/:eventId`, with
`CORS_ALLOWED_ORIGINS` set on the resolver) until `status === 'resolved'`, then
offer claims. The game backend signs the result event as before; in
`RESOLVER_MODE=anchor` the resolver verifies it, checks the registered market,
creator, resolver, approved mint, and deadline, then submits a genuine
`resolve_market` transaction and records `settlement` only after reading the
resolved market back. See the [resolver README](../../services/resolver/README.md#real-devnet-mode).

Resolver key requirements: the 64-byte keypair for
`6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt`, stored outside the repository
(mode 600) on the resolver host, referenced by `RESOLVER_KEYPAIR_PATH`, and funded
with Devnet SOL (about 5,000 lamports per resolution).

### Contract deadline issue and proposed fix (Developer A)

The deployed `resolve_market` checks the resolver (`has_one`), outcome, and Active
status, but not the deadline, so the resolver key could settle a market while it
still accepts stakes. The backend and SDK now enforce the deadline (local and
cluster clocks), which protects every resolution made through Hunch. The contract
should enforce it too. Proposed minimal fix in
`programs/marketkit/src/instructions/resolve_market.rs`:

```rust
require!(Clock::get()?.unix_timestamp >= market.deadline, MarketError::MarketStillOpen);
```

It reuses the existing `MarketStillOpen` (6004) error, so the IDL and account
layouts are unchanged; the SDK already maps 6004 to `MARKET_NOT_CLOSED`.
`programs/marketkit/tests/resolve_market.rs` covers rejection while open and one
second before the deadline, success at the deadline, single resolution, other
signers, and invalid outcomes. `claim_winnings.rs` now advances the clock before
resolving. On `feat/devnet-lifecycle`, Linux
[CI run 38097003483](https://github.com/manangandhi03146/HunchTrading/actions/runs/38097003483)
passed the original baseline, the intended failing regression against unpatched
source, and all **18 patched Rust tests**. It used Rust 1.89.0, Anchor 1.1.2,
Agave 4.1.2 and SBF platform-tools v1.54. Run `npm run test:contract` to reproduce
the patched build/tests without deployment; see the runbook for the baseline.
Deploying requires the program's upgrade authority and explicit approval; nothing
was deployed or upgraded.

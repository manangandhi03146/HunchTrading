# @hunch/sdk

Strict TypeScript SDK for binary pooled-stake markets. The complete mock is working;
real Solana calls fail explicitly until Developer A's actual IDL is integrated.
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
| `createMarket(params)` | `{ market, transaction, signature }` |
| `getMarket(id)` | `Market` or `null` |
| `listMarkets({ authority?, status? })` | `Market[]` |
| `predict({ marketId, outcome, amount })` | `{ position, transaction, signature }` |
| `getPositions(marketId, wallet?)` | `Position[]`; defaults to configured wallet, or all for read-only clients |
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

`new Hunch({ mode: 'anchor', rpcUrl, programId, wallet })` and legacy `mock: false`
throw `CONTRACT_UNAVAILABLE`. `AnchorMarketAdapter` implements the adapter boundary
but deliberately has no fabricated instructions or fallback.

Developer A's generated IDL/types are now checked into `src/idl/`, and public
Devnet identities are in `.env.example`. The adapter still needs to integrate
these artifacts and confirm the Anchor version, address/cluster, SPL mint/decimals,
exact PDA seeds and market ID encoding,
instruction parameters/accounts/signers, account layouts, error codes, and agreed
deadline/resolution/claim semantics. README seed sketches are not contract artifacts.
The dependencies include `@coral-xyz/anchor` 0.32.1, web3.js v1, and SPL Token; align
the Anchor client with A's actual toolchain before enabling real mode.

No real-chain integration test is claimed or run until the adapter is implemented.
Cancellation/refunds, balances, fees, and trading are outside the mock MVP.
See [handoff notes](HANDOFF.md) and the [resolver README](../../services/resolver/README.md).

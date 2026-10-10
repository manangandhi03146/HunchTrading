# Developer B handoff

## Developer A

There are no Anchor artifacts in this repository yet. The SDK's `AnchorMarketAdapter`
throws `CONTRACT_UNAVAILABLE` until actual contract integration is implemented.
Please provide:

- Generated IDL JSON, generated TypeScript types, and Anchor version.
- Deployed program address and cluster/RPC; test SPL mint and decimals.
- Exact market/position PDA seeds, market-ID byte encoding, and vault/ATA rules.
- Instruction names, arguments, account order/flags, and required signers for
  create, predict, resolve, and claim; fetch/list account layouts and errors.
- Deadline rules (our MVP resolves at or after the deadline), resolver authority,
  per-wallet/outcome position accumulation, proportional integer payouts, dust,
  double-claim prevention, and behavior when no one stakes on the winner.

Once supplied, replace the explicitly blocked adapter with contract calls and add
an opt-in local-validator/Devnet integration flow. Do not infer the wire interface
from README sketches. Real signed transaction recovery remains deferred.

## Developer C

Your files are untouched. Existing `@marketkit/sdk` imports and `MarketKit` class
continue working through a root npm alias. New development can import `Hunch` from
`@hunch/sdk` with the same public methods. Run `npm install` and `npm run sdk` first.

- For separately running React applications use `HttpMockMarketAdapter`, which
  connects both applications to the resolver's single authoritative mock ledger.
  Do not instantiate a separate in-memory `MockMarketAdapter` in those frontends.
- Read labels from `market.metadata`; format token values with `.toString()`.
- Catch `HunchError.code` for closed markets, invalid amounts, and repeated claims.
- Mock receipts have `mode: 'mock'`, an ID, and `signature: null`. Do not display
  them as blockchain transactions. Real mode currently fails explicitly.
- Supply a Solana wallet-adapter-compatible `WalletSigner` when real integration is
  available. Browser code never receives the game or resolver private key.
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
// The same exports are available from '@marketkit/sdk'.

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

You can retain `MarketKit` as the class name with the same constructor options.
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

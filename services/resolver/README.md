# Hunch resolver

Fastify service that verifies registered game-server Ed25519 results, checks market
ownership and deadlines, and immediately resolves through the trusted backend
adapter. SQLite persists registrations, market mappings, event IDs, and processing
status. No background worker is required.

## Run locally

From the repository root, using Node 22+:

```sh
npm install
cp .env.example .env
npm run build
npm test
npm run demo       # Complete racing + esports flow over localhost HTTP
npm run resolver   # Standalone API, default port 8787
```

`npm run start --workspace @marketkit/resolver` runs the built server. The server
loads the repository root `.env`; override with `ENV_FILE`. SQLite defaults to
`.data/resolver.sqlite`; set an absolute `RESOLVER_DB_PATH` to override it.

The standalone mock server owns the shared in-memory market ledger. Separately
running racing and esports applications use `HttpMockMarketAdapter` to create,
read, predict and claim against it. Register their signing public keys through the
CLI first; HTTP market creation automatically registers its market/event mapping.
The demo exercises the embedded flow and the two-client HTTP flow using temporary
SQLite files removed on exit.

## Mock HTTP API and access

| Method and path | Request / response |
| --- | --- |
| `POST /v1/mock/sessions` | `{ label? }` → server-issued simulated wallet and `sessionToken` |
| `GET /v1/mock/markets` | Optional `authority`, `status` query → `markets` |
| `POST /v1/mock/markets` | `{ appId, id?, question, outcomes, closesAt, description?, resolverAuthority? }` → creation result and registration |
| `GET /v1/mock/markets/:marketId` | `market`, or `null` for a missing market |
| `POST /v1/mock/markets/:marketId/predictions` | `{ outcome, amount: "40" }` → prediction result |
| `GET /v1/mock/markets/:marketId/positions` | Optional `wallet` read filter → `positions` |
| `POST /v1/mock/markets/:marketId/claims` | `{}` → claim result |
| `GET /v1/mock/transactions/:transactionId` | Mock receipt status |

Every success includes `mode: "mock"` and `simulated: true`; bigint fields are
canonical decimal strings. HTTP market IDs have a 119-character maximum to leave
space for `-finished`. Prediction amounts accept positive decimal strings up to
128 digits. Mutation requests reject caller-supplied wallet or authority fields.

`MOCK_HTTP_ENABLED=true` enables these routes only in mock mode. Library callers
must explicitly pass `mockHttp` to `buildServer`; Anchor adapters cannot enable it.
Default `MOCK_HTTP_ACCESS=local` requires a loopback bind host and checks the actual
client IP, Host, and browser Origin. Forwarded-IP headers are not trusted. Browser
origins default to localhost/127.0.0.1 ports 5173, 3000 and 4173. Set exact comma-separated
`MOCK_ALLOWED_ORIGINS` if needed; local mode only accepts loopback origins.

For an explicitly authenticated remote demo, select `MOCK_HTTP_ACCESS=token`, set
`MOCK_API_TOKEN` to a random credential of at least 32 characters, and configure
exact allowed origins and HOST. Every mock request then requires
`Authorization: Bearer <token>`, including session issuance. Use HTTPS for remote
demo credentials. Signed-event routes still require the app's Ed25519 signature.

Creating, predicting and claiming additionally require
`X-Hunch-Mock-Session: <sessionToken>`. Session tokens identify server-issued
simulated actors; an arbitrary wallet address is never authenticated as an owner.
Labels are display text, not login names. Anyone admitted to this development/demo
API can create simulated players and markets for registered applications. Market
creation uses the configured server creator, not an asserted session wallet.
There is no direct HTTP resolve endpoint.

## HTTP API

- `GET /health`: `{ ok, mode, pendingEvents }`.
- `POST /v1/events`: verify and resolve immediately; `200` confirmed, `202` pending,
  `400` malformed/expired, `401` invalid signature, `403` unauthorized,
  `404` missing adapter market, `409` conflicting replay, `422` ineligible market,
  `502` definite resolution failure.
- `GET /v1/events/:eventId`: durable event status (`200`), or `404`.

POST payload:

```json
{
  "appId": "racing-demo",
  "eventId": "race-42-finished",
  "marketId": "race-42",
  "outcome": 0,
  "timestamp": 1791662400,
  "signature": "<canonical base64 encoding of 64 signature bytes>"
}
```

Use the current Unix timestamp when submitting; the example timestamp will expire.
IDs use 1–128 ASCII letters, digits, `.`, `_`, `:`, or `-`, starting with a letter
or digit. Additional fields are rejected. Registered public keys are canonical
base64 encoding of 32 Ed25519 bytes. Wallet authorities use Solana base58 addresses.

## Signing contract

The exact UTF-8 bytes signed are:

```ts
JSON.stringify(['hunch:event:v1', appId, eventId, marketId, outcome, timestamp])
```

`canonicalEventPayload` from `@hunch/sdk/events` constructs these bytes. This
versioned domain includes all relevant fields and ignores JSON property order.
Never sign the signature field or an arbitrary raw JSON request body.

Events require an enabled app, its registered signing key, its market mapping,
the exact authorized event ID, matching adapter ownership/resolver authority,
a closed market, and a result timestamp at or after the deadline. Defaults:
maximum age 300 seconds, future skew 30 seconds, both configurable. An accepted
identical duplicate remains idempotent after that window expires.

## Register, sign, submit

Administrative registration runs locally, never as a public HTTP endpoint:

```sh
npm run register --workspace @marketkit/resolver -- \
  --app-id racing-demo --public-key '<base64 application public key>'

npm run register --workspace @marketkit/resolver -- \
  --app-id racing-demo --market-id race-42 --event-id race-42-finished \
  --authority '<creator base58 address>' --resolver-authority '<resolver base58 address>'
```

HTTP market creation registers `<marketId>-finished` automatically, so manual market
registration is only needed for embedded SDK-created markets. Repeating the same registration is
safe. Keys and market ownership cannot be silently reassigned. Disable an app by
repeating its app registration with `--disable` and the same public key.

On the trusted game server, use a 64-byte Ed25519 secret-key JSON array stored in
a private file. Never pass this key to a browser, commit it, or print it. The CLI
only prints the signed event. Paths below are relative to the resolver workspace:

```sh
mkdir -p .data
npm run --silent sign-event --workspace @marketkit/resolver -- \
  --keypair-path ../../.keys/racing-app.json --app-id racing-demo \
  --event-id race-42-finished --market-id race-42 --outcome 0 > .data/event.json

npm run submit-event --workspace @marketkit/resolver -- \
  --event-file ../../.data/event.json --url http://127.0.0.1:8787

curl -H 'Content-Type: application/json' \
  --data-binary @.data/event.json http://127.0.0.1:8787/v1/events
curl http://127.0.0.1:8787/v1/events/race-42-finished
```

The demo generates ephemeral keys itself, so no private-key setup is needed to
verify the complete MVP. Server-side applications can also import `signGameEvent`
from `@marketkit/resolver` and keep the secret key in their own backend.

## Persistence and limitations

SQLite uses foreign keys, WAL, unique event IDs, and a unique market reservation.
The state sequence is `received -> processing -> confirmed/submitted/failed`.
Reservation and state changes are transactional; concurrent duplicates initiate
one resolution. Identical duplicates return the existing record; changed signed
payloads return `409`. Failed duplicates return their recorded failure with `200`.
A `200` response means inspect `status`; it does not always mean confirmed.

Accepted events are never automatically retried, including failures. A timeout
reported as `TRANSACTION_UNCERTAIN` remains `submitted`; a process interrupted
during resolution leaves `processing`. Inspect transaction/on-chain state manually
before any later retry. Signed-byte persistence, rebroadcast, automatic recovery,
and expiry reconciliation are deferred until real contract integration.

Mock pools, positions, receipts and identity sessions are in backend memory; SQLite
persists only registrations/events. Restarting the resolver invalidates sessions
and resets the ledger. Previously registered market IDs cannot be reused through
HTTP creation after a restart, which prevents old event records from settling new
mock state. Use fresh market IDs, or a fresh development database and re-register
the apps; the demo does this automatically. Read filters are not ownership proofs.
A SQLite commit and a future blockchain transaction are not one atomic operation.

`RESOLVER_MODE=anchor` fails at startup until the generated IDL is integrated and cannot switch
to mock. The configured resolver private-key path is reserved for that integration
and is not loaded today. Real wallet signing/submission/confirmation and real-chain
tests remain blocked. See the [SDK handoff](../../packages/sdk/HANDOFF.md).

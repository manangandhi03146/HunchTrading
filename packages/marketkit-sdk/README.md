# MarketKit compatibility workspace

This workspace preserves the existing frontend `MarketKit` class and shared
types from the remote main branch. It also re-exports `Hunch`,
`HttpMockMarketAdapter`, and the other new Hunch APIs from `@hunch/sdk`.

The legacy `MarketKit` mock keeps its original independent in-memory state and
`MOCK_SIGNATURE` placeholder. It cannot connect to the shared HTTP backend.
Use `Hunch` with `HttpMockMarketAdapter` for separate applications sharing one
resolver; those receipts have `mode: 'mock'` and `signature: null`.

See [frontend usage and setup](../sdk/HANDOFF.md). Build from the repository root
with `npm run build`, or build this workspace with
`npm run build --workspace @marketkit/sdk`.

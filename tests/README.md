# Verification

Run `npm test` from the workspace root. The executable regression suite is in
`packages/react/src/test/` and covers the shared widget, frontend adapters,
and standalone SDK mock. It runs without a wallet, RPC connection, or real tokens.

Run `npm run build` to type-check and build the SDK, resolver scaffold, widget,
and all three apps.

The browser smoke test is documented in [the app guide](../apps/README.md):
create a market, connect a demo account, predict, close the race pool, run the
fixture, and claim once. Also check match switching and the dashboard's
integration preview at desktop and mobile widths.

The theme suite verifies saved preferences, device defaults and changes,
same-origin tab synchronization, keyboard switching, blocked storage, and
preservation of a widget's selected outcome and entered stake. The complete
suite currently contains 53 passing tests across six files.

On-chain end-to-end tests do not exist yet. Add them here once the Anchor
program and live SDK/resolver integration are implemented; mock test results
do not validate Devnet settlement.

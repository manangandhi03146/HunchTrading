import { parseArgs } from "node:util";
import { AnchorMarketAdapter, HUNCH_DEVNET_TOKEN_MINT } from "@hunch/sdk";
import { ResolverStore } from "./store.js";
import { loadConfig } from "./config.js";
import { reconcileEvent } from "./real-mode.js";

// Read-only on-chain reconciliation. Loads no private key and never signs or submits.
async function main() {
  const { values } = parseArgs({ options: {
    "event-id": { type: "string" }, list: { type: "boolean", default: false }, release: { type: "boolean", default: false },
  } });
  const config = loadConfig();
  const store = new ResolverStore(config.RESOLVER_DB_PATH);
  try {
    if (values.list) {
      console.log(JSON.stringify(store.unsettledEvents(), null, 2));
      return;
    }
    if (!values["event-id"]) throw new Error("Provide --event-id ID (optionally --release), or --list");
    if (config.RESOLVER_MODE !== "anchor") throw new Error("Reconciliation reads Devnet; set RESOLVER_MODE=anchor");
    const adapter = new AnchorMarketAdapter({ rpcUrl: config.SOLANA_RPC_URL, programId: config.HUNCH_PROGRAM_ID,
      tokenMint: config.TEST_TOKEN_MINT ?? HUNCH_DEVNET_TOKEN_MINT });
    const result = await reconcileEvent({ store, adapter, eventId: values["event-id"], now: Math.floor(Date.now() / 1000), release: values.release });
    console.log(JSON.stringify(result, null, 2));
    if (result.action === "released") console.error("Released: the application may now sign and submit a fresh event with the same event ID.");
  } finally { store.close(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Reconciliation failed");
  process.exitCode = 1;
});

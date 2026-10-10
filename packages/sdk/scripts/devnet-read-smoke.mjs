import assert from "node:assert/strict";
import { AnchorMarketAdapter } from "../dist/index.js";

// Opt-in RPC smoke check. No keypairs, wallets, signing, or transaction APIs.
const adapter = new AnchorMarketAdapter({ rpcUrl: process.env.SOLANA_RPC_URL });
assert.equal(await adapter.connection.getGenesisHash(), "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "RPC must be Solana Devnet");
const program = await adapter.connection.getAccountInfo(adapter.programId, "confirmed");
assert.ok(program?.executable, "The configured Devnet program must exist and be executable");
const markets = await adapter.listMarkets();
for (const listed of markets.slice(0, 5)) {
  const market = await adapter.getMarket(listed.id);
  assert.ok(market, "A listed Market must be readable by its PDA");
  assert.equal(market.id, listed.id);
  assert.equal(typeof market.totalPool, "bigint");
}
console.log(JSON.stringify({
  result: "PASS", mode: "anchor", readOnly: true, programId: adapter.programId.toBase58(),
  programExecutable: program.executable, marketCount: markets.length,
  sampledMarketReads: Math.min(markets.length, 5),
  message: markets.length ? "Read existing on-chain markets" : "Program connectivity verified; no Market accounts exist; returned []",
}, null, 2));

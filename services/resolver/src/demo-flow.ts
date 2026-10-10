import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { Hunch, MockMarketAdapter, createMockWallet } from "@hunch/sdk";
import { buildServer } from "./server.js";
import { ResolverStore } from "./store.js";
import type { EventRecord } from "./store.js";
import { signGameEvent } from "./signing.js";

/** Full Fastify routes and Ed25519 verification; all token/transaction activity is explicitly mock. */
export async function runMockDemo(options: { transport?: "http" | "inject" } = {}) {
  let now = Math.floor(Date.now() / 1000);
  const clock = () => now;
  const [creator, resolver, alice, bob] = Array.from({ length: 4 }, () => createMockWallet(Keypair.generate().publicKey));
  const adapter = new MockMarketAdapter({ resolverAuthority: resolver.publicKey.toBase58(), authorizedCreators: [creator.publicKey.toBase58()], clock });
  const owner = new Hunch({ adapter, wallet: creator });
  const a = new Hunch({ adapter, wallet: alice });
  const b = new Hunch({ adapter, wallet: bob });
  const directory = mkdtempSync(join(tmpdir(), "hunch-demo-"));
  const store = new ResolverStore(join(directory, "resolver.sqlite"));
  const server = buildServer({ adapter, signer: resolver, store, clock });
  const scenarios = [
    { appId: "racing-demo", marketId: "race-42", eventId: "race-42-finished", question: "Who wins race 42?", outcomes: ["Driver A", "Driver B"] as [string, string] },
    { appId: "esports-demo", marketId: "tournament-final", eventId: "tournament-final-finished", question: "Who wins the final?", outcomes: ["Team A", "Team B"] as [string, string] },
  ];
  const gameKeys = scenarios.map(() => nacl.sign.keyPair());
  try {
    for (const [index, scenario] of scenarios.entries()) {
      store.registerApp({ appId: scenario.appId, publicKey: Buffer.from(gameKeys[index].publicKey).toString("base64"), enabled: true });
      await owner.createMarket({ id: scenario.marketId, question: scenario.question, outcomes: scenario.outcomes, closesAt: now + 1 });
      store.registerMarket({ appId: scenario.appId, marketId: scenario.marketId, eventId: scenario.eventId, authority: creator.publicKey.toBase58(), resolverAuthority: resolver.publicKey.toBase58() });
      await a.predict({ marketId: scenario.marketId, outcome: 0, amount: 40n });
      await b.predict({ marketId: scenario.marketId, outcome: 1, amount: 60n });
    }
    now += 1; // Deterministic simulated deadline; the signature itself is genuine.
    const address = options.transport === "http" ? await server.listen({ port: 0, host: "127.0.0.1" }) : null;
    const request = async (method: "GET" | "POST", url: string, payload?: unknown) => {
      if (address) return fetch(`${address}${url}`, { method, headers: { "content-type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
      const response = await server.inject({ method, url, payload: payload as object | undefined });
      return { status: response.statusCode, json: async () => response.json() as unknown };
    };
    const results = [];
    for (const [index, scenario] of scenarios.entries()) {
      const event = signGameEvent({ appId: scenario.appId, eventId: scenario.eventId, marketId: scenario.marketId, outcome: 0, timestamp: now }, gameKeys[index].secretKey);
      const submit = () => request("POST", "/v1/events", event);
      const response = await submit();
      assert.equal(response.status, 200);
      const accepted = await response.json() as EventRecord;
      assert.equal(accepted.status, "confirmed");
      assert.equal(accepted.transaction?.mode, "mock");
      assert.equal(accepted.transaction?.signature, null);
      const lookup = await request("GET", `/v1/events/${scenario.eventId}`);
      assert.equal((await lookup.json() as EventRecord).status, "confirmed");
      const duplicate = await submit();
      assert.equal(duplicate.status, 200);
      assert.deepEqual(await duplicate.json(), accepted);
      const payout = await a.claimWinnings(scenario.marketId);
      assert.equal(payout.payout, 100n);
      await assert.rejects(() => a.claimWinnings(scenario.marketId), { code: "ALREADY_CLAIMED" });
      await assert.rejects(() => b.claimWinnings(scenario.marketId), { code: "NO_WINNING_POSITION" });
      results.push({ marketId: scenario.marketId, status: accepted.status, payout: payout.payout.toString(), resolutionReceipt: accepted.transaction!.id, claimReceipt: payout.transaction.id, signature: null });
    }
    return { mode: "mock" as const, signatureVerification: "Ed25519" as const, scenarios: results };
  } finally {
    await server.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

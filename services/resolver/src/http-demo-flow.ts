import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { Hunch, HttpMockMarketAdapter, MockMarketAdapter, createMockWallet } from "@hunch/sdk";
import { buildServer } from "./server.js";
import { ResolverStore } from "./store.js";
import { signGameEvent } from "./signing.js";

/** Two independent HTTP clients share only a backend URL, never the backend adapter. */
export async function runHttpMockDemo(options: { transport?: "http" | "inject" } = {}) {
  let now = Math.floor(Date.now() / 1000);
  const creator = createMockWallet(Keypair.generate().publicKey);
  const resolver = createMockWallet(Keypair.generate().publicKey);
  const backendAdapter = new MockMarketAdapter({ resolverAuthority: resolver.publicKey.toBase58(),
    authorizedCreators: [creator.publicKey.toBase58()], clock: () => now });
  const directory = mkdtempSync(join(tmpdir(), "hunch-http-demo-"));
  const store = new ResolverStore(join(directory, "resolver.sqlite"));
  const server = buildServer({ adapter: backendAdapter, signer: resolver, store, clock: () => now,
    mockHttp: { access: "local", creator } });
  const racingKey = nacl.sign.keyPair(), esportsKey = nacl.sign.keyPair();
  store.registerApp({ appId: "racing-demo", publicKey: Buffer.from(racingKey.publicKey).toString("base64"), enabled: true });
  store.registerApp({ appId: "esports-demo", publicKey: Buffer.from(esportsKey.publicKey).toString("base64"), enabled: true });
  try {
    const address = options.transport === "http" ? await server.listen({ port: 0, host: "127.0.0.1" }) : "http://localhost";
    const fetcher: typeof fetch = options.transport === "http" ? globalThis.fetch : async (input, init) => {
      const url = new URL(String(input));
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
      const response = await server.inject({ method: init?.method as "GET" | "POST", url: url.pathname + url.search,
        headers, payload: init?.body as string | undefined });
      return new Response(response.body, { status: response.statusCode });
    };
    const racing = await HttpMockMarketAdapter.connect({ baseUrl: address, appId: "racing-demo", label: "Simulated racing player", fetch: fetcher });
    const esports = await HttpMockMarketAdapter.connect({ baseUrl: address, appId: "esports-demo", label: "Simulated esports player", fetch: fetcher });
    const a = new Hunch({ adapter: racing, wallet: racing.wallet });
    const b = new Hunch({ adapter: esports, wallet: esports.wallet });
    assert.notEqual(racing.wallet!.publicKey.toBase58(), esports.wallet!.publicKey.toBase58());
    await a.createMarket({ id: "race-42", question: "Who wins race 42?", outcomes: ["Driver A", "Driver B"], closesAt: now + 1 });
    await b.createMarket({ id: "tournament-final", question: "Who wins the final?", outcomes: ["Team A", "Team B"], closesAt: now + 1 });
    assert.equal((await a.listMarkets()).length, 2);
    assert.equal((await b.listMarkets()).length, 2);
    for (const marketId of ["race-42", "tournament-final"]) {
      await a.predict({ marketId, outcome: 0, amount: 40n });
      await b.predict({ marketId, outcome: 1, amount: 60n });
      assert.deepEqual((await a.getMarket(marketId))?.pools, [40n, 60n]);
      assert.deepEqual(await a.getMarket(marketId), await b.getMarket(marketId));
    }
    now += 1;
    const results = [];
    for (const [appId, marketId, key] of [["racing-demo", "race-42", racingKey], ["esports-demo", "tournament-final", esportsKey]] as const) {
      const event = signGameEvent({ appId, marketId, eventId: `${marketId}-finished`, outcome: 0, timestamp: now }, key.secretKey);
      const response = await fetcher(`${address}/v1/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
      assert.equal(response.status, 200);
      assert.equal((await response.json() as { status: string }).status, "confirmed");
      assert.equal((await b.getMarket(marketId))?.status, "resolved");
      const claim = await a.claimWinnings(marketId);
      assert.equal(claim.payout, 100n);
      assert.equal(claim.signature, null);
      await assert.rejects(() => a.claimWinnings(marketId), { code: "ALREADY_CLAIMED" });
      await assert.rejects(() => b.claimWinnings(marketId), { code: "NO_WINNING_POSITION" });
      assert.equal((await a.getPositions(marketId))[0].claimed, true);
      assert.equal((await b.getTransactionStatus(claim.transaction.id)).status, "confirmed");
      results.push({ marketId, payout: claim.payout.toString(), signature: null });
    }
    return { mode: "mock" as const, simulatedIdentities: true, independentClients: 2, scenarios: results };
  } finally {
    await server.close(); store.close(); rmSync(directory, { recursive: true, force: true });
  }
}

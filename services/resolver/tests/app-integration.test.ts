import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { MockMarketAdapter, HttpMockMarketAdapter, createMockWallet } from "@hunch/sdk";
import type { MarketAdapter } from "@hunch/sdk";
import { buildServer } from "../src/server.js";
import { ResolverStore } from "../src/store.js";
import { signGameEvent } from "../src/signing.js";

describe("public app integration", () => {
  it("shares creation, separate identities, finite balances, signed settlement, claims and replay across sessions", async () => {
    let now = 2000000000;
    const resolver = createMockWallet(new PublicKey(new Uint8Array(32).fill(2)));
    const creator = createMockWallet(new PublicKey(new Uint8Array(32).fill(1)));
    const adapter = new MockMarketAdapter({ resolverAuthority: resolver.publicKey.toBase58(), authorizedCreators: [creator.publicKey.toBase58()], initialBalance: 1000n, clock: () => now });
    const store = new ResolverStore(":memory:"), key = nacl.sign.keyPair();
    store.registerApp({ appId: "hunch-web", publicKey: Buffer.from(key.publicKey).toString("base64"), enabled: true });
    const server = buildServer({ adapter, signer: resolver, store, clock: () => now, mockHttp: { creator, access: "local" } });
    const transport: typeof fetch = async (input, init) => {
      const response = await server.inject({ method: init?.method as "GET" | "POST", url: new URL(String(input)).pathname, headers: { host: "localhost:8787", ...(init?.headers as Record<string, string>) }, payload: init?.body as string | undefined });
      return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } });
    };
    try {
      const options = { baseUrl: "http://localhost:8787", appId: "hunch-web", fetch: transport };
      const [a, b, c] = await Promise.all([HttpMockMarketAdapter.connect(options), HttpMockMarketAdapter.connect(options), HttpMockMarketAdapter.connect(options)]);
      expect(a.wallet!.publicKey.equals(b.wallet!.publicKey)).toBe(false);
      const created = await a.createMarket({ id: "shared-verification", question: "Does outcome one win?", outcomes: ["No", "Yes"], closesAt: now + 10 }, a.wallet!);
      expect((await b.getMarket(created.market.id))?.metadata?.question).toBe("Does outcome one win?");
      await a.predict({ marketId: created.market.id, outcome: 1, amount: 100n }, a.wallet!);
      await c.predict({ marketId: created.market.id, outcome: 1, amount: 200n }, c.wallet!);
      await b.predict({ marketId: created.market.id, outcome: 0, amount: 250n }, b.wallet!);
      await expect(b.predict({ marketId: created.market.id, outcome: 0, amount: 751n }, b.wallet!)).rejects.toThrow("Insufficient");
      expect((await a.getMarket(created.market.id))?.pools).toEqual([250n, 300n]);
      now += 10;
      const event = signGameEvent({ appId: "hunch-web", eventId: "shared-verification-finished", marketId: created.market.id, outcome: 1, timestamp: now }, key.secretKey);
      const resolved = await server.inject({ method: "POST", url: "/v1/events", payload: event });
      expect(resolved.statusCode).toBe(200);
      const replay = await server.inject({ method: "POST", url: "/v1/events", payload: event });
      expect(replay.json().transaction).toEqual(resolved.json().transaction);
      expect((await a.claimWinnings(created.market.id, a.wallet!)).payout).toBe(183n);
      expect((await c.claimWinnings(created.market.id, c.wallet!)).payout).toBe(366n);
      expect(adapter.getTokenBalance(a.wallet!.publicKey.toBase58())).toBe(1083n);
      expect(adapter.getTokenBalance(c.wallet!.publicKey.toBase58())).toBe(1166n);
      expect(adapter.getTokenBalance(b.wallet!.publicKey.toBase58())).toBe(750n);
      await expect(a.claimWinnings(created.market.id, a.wallet!)).rejects.toThrow("already claimed");
      const activity = await server.inject({ method: "GET", url: "/v1/activity" });
      expect(activity.json().events.some((e: { type: string }) => e.type === "claim")).toBe(true);
    } finally { await server.close(); store.close(); }
  });
  it("requires the on-chain authority to sign immutable shared labels", async () => {
    const key = nacl.sign.keyPair();
    const marketId = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
    const store = new ResolverStore(":memory:");
    const adapter = { mode: "anchor", getMarket: async () => ({ id: marketId, authority: new PublicKey(key.publicKey).toBase58() }) } as unknown as MarketAdapter;
    const server = buildServer({ adapter, signer: createMockWallet(new PublicKey(new Uint8Array(32).fill(2))), store });
    const metadata = { marketId, question: "Original question", outcomes: ["No", "Yes"] };
    const sign = (m: typeof metadata) => Buffer.from(nacl.sign.detached(new TextEncoder().encode(`hunch:market-metadata:v1\n${JSON.stringify(m)}`), key.secretKey)).toString("base64");
    try {
      expect((await server.inject({ method: "POST", url: "/v1/metadata", payload: { metadata, signature: "invalid" } })).statusCode).toBe(403);
      expect((await server.inject({ method: "POST", url: "/v1/metadata", payload: { metadata, signature: sign(metadata) } })).statusCode).toBe(200);
      const changed = { ...metadata, question: "Changed question" };
      expect((await server.inject({ method: "POST", url: "/v1/metadata", payload: { metadata: changed, signature: sign(changed) } })).statusCode).toBe(409);
      expect((await server.inject({ method: "GET", url: "/v1/metadata" })).json().metadata).toEqual([metadata]);
    } finally { await server.close(); store.close(); }
  });
});

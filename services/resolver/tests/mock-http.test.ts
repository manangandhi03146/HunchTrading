import { afterEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { Hunch, HttpMockMarketAdapter, MockMarketAdapter, createMockWallet } from "@hunch/sdk";
import { buildServer } from "../src/server.js";
import { ResolverStore } from "../src/store.js";
import { signGameEvent } from "../src/signing.js";
import { runHttpMockDemo } from "../src/http-demo-flow.js";

const creator = createMockWallet(new PublicKey(new Uint8Array(32).fill(1)));
const resolver = createMockWallet(new PublicKey(new Uint8Array(32).fill(2)));
const signingKeys = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(10));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
function setup(access: "local" | "token" = "local", token = "demo-access-token-for-integration-tests", origins?: string[]) {
  let now = 1000;
  const backend = new MockMarketAdapter({ resolverAuthority: resolver.publicKey.toBase58(), authorizedCreators: [creator.publicKey.toBase58()], clock: () => now });
  const store = new ResolverStore(":memory:");
  store.registerApp({ appId: "racing-demo", publicKey: Buffer.from(signingKeys.publicKey).toString("base64"), enabled: true });
  store.registerApp({ appId: "esports-demo", publicKey: Buffer.from(signingKeys.publicKey).toString("base64"), enabled: true });
  const server = buildServer({ adapter: backend, signer: resolver, store, clock: () => now,
    mockHttp: { creator, access, accessToken: token, allowedOrigins: origins } });
  cleanups.push(async () => { await server.close(); store.close(); });
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    const response = await server.inject({ method: init?.method as "GET" | "POST", url: url.pathname + url.search,
      headers: { ...headers, origin: "http://localhost:5173" },
      payload: init?.body as string | undefined });
    return new Response(response.body, { status: response.statusCode });
  };
  const connect = (appId = "racing-demo", accessToken?: string) => HttpMockMarketAdapter.connect({ baseUrl: "http://localhost", appId, fetch: transport, accessToken });
  const create = (client: Hunch, id = "race-42") => client.createMarket({ id, question: "Who wins?", outcomes: ["A", "B"], closesAt: 1100 });
  return { server, backend, store, transport, connect, create, setTime: (time: number) => { now = time; } };
}
async function clients(s: ReturnType<typeof setup>) {
  const aa = await s.connect("racing-demo"), bb = await s.connect("esports-demo");
  return { a: new Hunch({ adapter: aa, wallet: aa.wallet }), b: new Hunch({ adapter: bb, wallet: bb.wallet }), aa, bb };
}

describe("shared mock HTTP integration", () => {
  it("runs two independent HTTP adapters through signed resolution and claims", async () => {
    const result = await runHttpMockDemo();
    expect(result.independentClients).toBe(2);
    expect(result.simulatedIdentities).toBe(true);
    expect(result.scenarios).toEqual([{ marketId: "race-42", payout: "100", signature: null }, { marketId: "tournament-final", payout: "100", signature: null }]);
  });
  it("shares racing and esports markets, pools, positions and receipts across clients", async () => {
    const s = setup(); const { a, b } = await clients(s);
    const made = await s.create(a);
    await s.create(b, "esports-final");
    expect(made.market.authority).toBe(creator.publicKey.toBase58());
    expect(await a.listMarkets()).toHaveLength(2);
    expect(await b.listMarkets()).toHaveLength(2);
    expect(await b.getMarket("missing")).toBeNull();
    const huge = 2n ** 100n;
    const prediction = await a.predict({ marketId: "race-42", outcome: 0, amount: huge });
    await b.predict({ marketId: "race-42", outcome: 1, amount: 7n });
    expect((await b.getMarket("race-42"))?.totalPool).toBe(huge + 7n);
    expect(await b.getTransactionStatus(prediction.transaction.id)).toMatchObject({ mode: "mock", signature: null, status: "confirmed" });
    expect((await b.getTransactionStatus("mock:999")).status).toBe("not_found");
    expect(await b.getPositions("race-42")).toHaveLength(1);
    expect(await b.getPositions("race-42", a.wallet!.publicKey.toBase58())).toHaveLength(1);
    expect(await a.listMarkets({ authority: creator.publicKey.toBase58(), status: "open" })).toHaveLength(2);
  });
  it("transmits amounts only as decimal strings and restores bigint to the SDK", async () => {
    const s = setup(); const { a, aa } = await clients(s);
    await s.create(a);
    const result = await a.predict({ marketId: "race-42", outcome: 0, amount: 9007199254740993n });
    expect(result.position.amount).toBe(9007199254740993n);
    const raw = await s.server.inject({ method: "GET", url: "/v1/mock/markets/race-42" });
    expect(raw.json()).toMatchObject({ mode: "mock", simulated: true, market: { totalPool: "9007199254740993", pools: ["9007199254740993", "0"] } });
    const positions = await s.server.inject({ method: "GET", url: `/v1/mock/markets/race-42/positions?wallet=${aa.session!.wallet}` });
    expect(positions.json().positions[0].amount).toBe("9007199254740993");
  });
  it("uses server-issued simulated identities and never accepts a claimed wallet", async () => {
    const s = setup(); const { a, b, aa, bb } = await clients(s);
    expect(aa.session?.simulated).toBe(true);
    expect(aa.session?.wallet).not.toBe(bb.session?.wallet);
    await s.create(a);
    const impersonation = await s.server.inject({ method: "POST", url: "/v1/mock/markets/race-42/predictions",
      headers: { "x-hunch-mock-session": aa.session!.sessionToken }, payload: { outcome: 0, amount: "10", wallet: bb.session!.wallet } });
    expect(impersonation.statusCode).toBe(400);
    await expect(aa.predict({ marketId: "race-42", outcome: 0, amount: 10n }, b.wallet!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(aa.wallet!.signTransaction({} as never)).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
  });
  it("requires a valid issued session on every mutation", async () => {
    const s = setup(); const { a } = await clients(s); await s.create(a);
    for (const [url, payload] of [["/v1/mock/markets", { appId: "racing-demo", id: "new", question: "Q", outcomes: ["A", "B"], closesAt: 1100 }],
      ["/v1/mock/markets/race-42/predictions", { outcome: 0, amount: "1" }], ["/v1/mock/markets/race-42/claims", {}]] as const) {
      expect((await s.server.inject({ method: "POST", url, payload })).statusCode).toBe(401);
      expect((await s.server.inject({ method: "POST", url, payload, headers: { "x-hunch-mock-session": "fake" } })).statusCode).toBe(401);
    }
  });
  it.each([0, -1, "0", "-1", "1.5", "01", "1e3", "1".repeat(129)])("rejects invalid wire stake %s", async (amount) => {
    const s = setup(); const { a, aa } = await clients(s); await s.create(a);
    const response = await s.server.inject({ method: "POST", url: "/v1/mock/markets/race-42/predictions",
      headers: { "x-hunch-mock-session": aa.session!.sessionToken }, payload: { outcome: 0, amount } });
    expect(response.statusCode).toBe(400);
    expect((await a.getMarket("race-42"))?.totalPool).toBe(0n);
  });
  it("keeps creation tied to registered apps, trusted creator and authorized signed events", async () => {
    const s = setup(); const { a, aa } = await clients(s);
    const made = await s.create(a);
    expect(s.store.getMarketMapping(made.market.id)).toMatchObject({ appId: "racing-demo", eventId: "race-42-finished", authority: creator.publicKey.toBase58(), resolverAuthority: resolver.publicKey.toBase58() });
    const unknown = await s.connect("unknown");
    await expect(s.create(new Hunch({ adapter: unknown, wallet: unknown.wallet }), "unknown-market")).rejects.toMatchObject({ details: { backendCode: "UNKNOWN_APPLICATION" } });
    await expect(a.resolveMarket("race-42", 0)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await s.server.inject({ method: "POST", url: "/v1/mock/markets/race-42/resolve", payload: { outcome: 0 } })).statusCode).toBe(404);
    s.setTime(1100);
    const event = signGameEvent({ appId: "racing-demo", marketId: "race-42", eventId: "race-42-finished", outcome: 0, timestamp: 1100 }, signingKeys.secretKey);
    event.signature = Buffer.from(new Uint8Array(64)).toString("base64");
    expect((await s.server.inject({ method: "POST", url: "/v1/events", payload: event })).statusCode).toBe(401);
    expect((await aa.getMarket("race-42"))?.status).toBe("closed");
  });
  it("rolls back registration when the existing adapter rejects market creation", async () => {
    const s = setup(); const { a } = await clients(s);
    await expect(a.createMarket({ id: "bad-deadline", question: "Q", outcomes: ["A", "B"], closesAt: 999 })).rejects.toMatchObject({ code: "INVALID_DEADLINE" });
    expect(s.store.getMarketMapping("bad-deadline")).toBeNull();
    expect(await a.getMarket("bad-deadline")).toBeNull();
    await s.create(a, "bad-deadline");
  });
  it("does not reuse a durable mapping for reset in-memory state", async () => {
    const s = setup(); const { a } = await clients(s);
    s.store.registerMarket({ appId: "racing-demo", marketId: "old-market", eventId: "old-market-finished", authority: creator.publicKey.toBase58(), resolverAuthority: resolver.publicKey.toBase58() });
    await expect(s.create(a, "old-market")).rejects.toMatchObject({ code: "MARKET_EXISTS" });
    expect(await a.getMarket("old-market")).toBeNull();
  });
  it("reuses an issued session across independent adapter instances", async () => {
    const s = setup(); const { a, aa } = await clients(s); await s.create(a);
    const fresh = new HttpMockMarketAdapter({ baseUrl: "http://localhost", session: aa.session, fetch: s.transport });
    const reloaded = new Hunch({ adapter: fresh, wallet: fresh.wallet });
    await reloaded.predict({ marketId: "race-42", outcome: 0, amount: 5n });
    expect((await a.getPositions("race-42"))[0].amount).toBe(5n);
  });
  it("accumulates concurrent client predictions and pays one concurrent winner claim", async () => {
    const s = setup(); const { a, b } = await clients(s); await s.create(a);
    await Promise.all(Array.from({ length: 5 }, () => [
      a.predict({ marketId: "race-42", outcome: 0, amount: 2n }),
      b.predict({ marketId: "race-42", outcome: 1, amount: 3n }),
    ]).flat());
    expect((await b.getMarket("race-42"))?.pools).toEqual([10n, 15n]);
    s.setTime(1100);
    const event = signGameEvent({ appId: "racing-demo", marketId: "race-42", eventId: "race-42-finished", outcome: 0, timestamp: 1100 }, signingKeys.secretKey);
    expect((await s.server.inject({ method: "POST", url: "/v1/events", payload: event })).statusCode).toBe(200);
    const results = await Promise.allSettled([a.claimWinnings("race-42"), a.claimWinnings("race-42")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "fulfilled")).toMatchObject({ value: { payout: 25n } });
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "ALREADY_CLAIMED" } });
  });
  it("does not let a losing session claim winnings by supplying a winning wallet address", async () => {
    const s = setup(); const { a, b, bb } = await clients(s); await s.create(a);
    await a.predict({ marketId: "race-42", outcome: 0, amount: 1n });
    await b.predict({ marketId: "race-42", outcome: 1, amount: 1n });
    s.setTime(1100);
    const event = signGameEvent({ appId: "racing-demo", marketId: "race-42", eventId: "race-42-finished", outcome: 0, timestamp: 1100 }, signingKeys.secretKey);
    await s.server.inject({ method: "POST", url: "/v1/events", payload: event });
    const attempt = await s.server.inject({ method: "POST", url: "/v1/mock/markets/race-42/claims",
      payload: { wallet: a.wallet!.publicKey.toBase58() }, headers: { "x-hunch-mock-session": bb.session!.sessionToken } });
    expect(attempt.statusCode).toBe(400);
    await expect(b.claimWinnings("race-42")).rejects.toMatchObject({ code: "NO_WINNING_POSITION" });
    expect((await a.claimWinnings("race-42")).payout).toBe(2n);
  });
});

describe("mock HTTP access restrictions", () => {
  it("rejects non-loopback clients and DNS rebinding hosts in local mode", async () => {
    const s = setup();
    expect((await s.server.inject({ method: "POST", url: "/v1/mock/sessions", payload: {}, remoteAddress: "203.0.113.5" })).statusCode).toBe(403);
    expect((await s.server.inject({ method: "POST", url: "/v1/mock/sessions", payload: {}, headers: { host: "evil.example" } })).statusCode).toBe(403);
    expect((await s.server.inject({ method: "POST", url: "/v1/mock/sessions", payload: {}, remoteAddress: "203.0.113.5", headers: { "x-forwarded-for": "127.0.0.1" } })).statusCode).toBe(403);
  });
  it("rejects unapproved browser origins and permits configured frontend CORS preflight", async () => {
    const s = setup();
    expect((await s.server.inject({ method: "POST", url: "/v1/mock/sessions", payload: {}, headers: { origin: "https://evil.example" } })).statusCode).toBe(403);
    const preflight = await s.server.inject({ method: "OPTIONS", url: "/v1/mock/markets", headers: {
      origin: "http://localhost:5173", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-hunch-mock-session",
    } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(preflight.headers["access-control-allow-headers"]).toMatch(/X-Hunch-Mock-Session/i);
    const other = await s.server.inject({ method: "OPTIONS", url: "/v1/mock/markets", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("requires explicit authenticated demo access for non-loopback callers", async () => {
    const token = "explicit-demo-access-token-of-32-plus-characters";
    const s = setup("token", token);
    for (const auth of [undefined, "Bearer wrong"]) {
      expect((await s.server.inject({ method: "POST", url: "/v1/mock/sessions", payload: {}, remoteAddress: "203.0.113.5", headers: auth ? { authorization: auth } : {} })).statusCode).toBe(401);
    }
    const response = await s.server.inject({ method: "POST", url: "/v1/mock/sessions", payload: {}, remoteAddress: "203.0.113.5", headers: { authorization: `Bearer ${token}`, host: "demo.example" } });
    expect(response.statusCode).toBe(201);
    const aa = await s.connect("racing-demo", token);
    const a = new Hunch({ adapter: aa, wallet: aa.wallet });
    await s.create(a);
    expect((await s.server.inject({ method: "POST", url: "/v1/mock/markets/race-42/predictions", payload: { amount: "1", outcome: 0 }, headers: { "x-hunch-mock-session": aa.session!.sessionToken } })).statusCode).toBe(401);
  });
  it("fails closed for an unsafe access configuration or real-chain adapter", async () => {
    const store = new ResolverStore(":memory:");
    const backend = new MockMarketAdapter({ authorizedCreators: [creator.publicKey.toBase58()], resolverAuthority: resolver.publicKey.toBase58() });
    const options = { adapter: backend, signer: resolver, store };
    try {
      expect(() => buildServer({ ...options, mockHttp: { creator, access: "token", accessToken: "short" } })).toThrow(/32 characters/);
      expect(() => buildServer({ ...options, mockHttp: { creator, access: "local", allowedOrigins: ["https://remote.example"] } })).toThrow(/loopback origins/);
      const fakeReal = Object.assign(Object.create(backend), { mode: "anchor" });
      expect(() => buildServer({ ...options, adapter: fakeReal, mockHttp: { creator, access: "local" } })).toThrow(/real-chain adapter/);
    } finally { store.close(); }
  });
  it("keeps mock HTTP routes absent when not explicitly enabled", async () => {
    const s = setup();
    const disabled = buildServer({ adapter: s.backend, signer: resolver, store: s.store });
    try { expect((await disabled.inject({ method: "POST", url: "/v1/mock/sessions", payload: {} })).statusCode).toBe(404); }
    finally { await disabled.close(); }
  });
});

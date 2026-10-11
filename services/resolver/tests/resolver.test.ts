import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { Hunch, MockMarketAdapter, createMockWallet, canonicalEventPayload, HunchError } from "@hunch/sdk";
import type { SignedGameEvent } from "@hunch/sdk";
import { buildServer } from "../src/server.js";
import { ResolverStore } from "../src/store.js";
import { payloadHash } from "../src/validation.js";

const wallet = (n: number) => createMockWallet(new PublicKey(new Uint8Array(32).fill(n)));
const creator = wallet(1), resolver = wallet(2), alice = wallet(3), bob = wallet(4);
const keys = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function setup(path = ":memory:", mappingAuthority = creator.publicKey.toBase58()) {
  let time = 1000;
  const clock = () => time;
  const adapter = new MockMarketAdapter({ resolverAuthority: resolver.publicKey.toBase58(), authorizedCreators: [creator.publicKey.toBase58()], clock });
  const owner = new Hunch({ adapter, wallet: creator });
  const a = new Hunch({ adapter, wallet: alice });
  const b = new Hunch({ adapter, wallet: bob });
  await owner.createMarket({ id: "race-42", question: "Who wins?", outcomes: ["A", "B"], closesAt: 1100 });
  await a.predict({ marketId: "race-42", outcome: 0, amount: 10n });
  await b.predict({ marketId: "race-42", outcome: 1, amount: 20n });
  time = 1100;
  const store = new ResolverStore(path);
  store.registerApp({ appId: "racing-demo", publicKey: Buffer.from(keys.publicKey).toString("base64"), enabled: true });
  store.registerMarket({ appId: "racing-demo", marketId: "race-42", eventId: "race-42-finished", authority: mappingAuthority, resolverAuthority: resolver.publicKey.toBase58() });
  const app = buildServer({ adapter, signer: resolver, store, clock });
  cleanups.push(async () => { await app.close(); store.close(); });
  const sign = (overrides: Partial<SignedGameEvent> = {}, signerKeys = keys): SignedGameEvent => {
    const event = { appId: "racing-demo", eventId: "race-42-finished", marketId: "race-42", outcome: 0 as const, timestamp: 1100, ...overrides };
    return { ...event, signature: Buffer.from(nacl.sign.detached(canonicalEventPayload(event), signerKeys.secretKey)).toString("base64") };
  };
  const post = (payload: unknown) => app.inject({ method: "POST", url: "/v1/events", payload: payload as object });
  return { app, store, adapter, owner, a, b, clock, sign, post, setTime: (value: number) => { time = value; } };
}

describe("signed-event resolver", () => {
  it("serves health and event lookup", async () => {
    const { app } = await setup();
    expect((await app.inject("/health")).json()).toEqual({ ok: true, mode: "mock", pendingEvents: 0 });
    expect((await app.inject("/v1/events/missing")).statusCode).toBe(404);
  });
  it("verifies a genuine Ed25519 signature and resolves through the authorized signer", async () => {
    const { post, sign, owner, app } = await setup();
    const response = await post(sign());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ eventId: "race-42-finished", status: "confirmed", transaction: { mode: "mock", signature: null } });
    expect((await owner.getMarket("race-42"))?.winningOutcome).toBe(0);
    expect((await app.inject("/v1/events/race-42-finished")).json().status).toBe("confirmed");
  });
  it("rejects signatures made by a different application key", async () => {
    const { post, sign, store } = await setup();
    const response = await post(sign({}, nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8))));
    expect(response.statusCode).toBe(401);
    expect(store.getEvent("race-42-finished")).toBeNull();
  });
  it.each(["appId", "eventId", "marketId", "outcome", "timestamp"] as const)("rejects modified signed field %s", async (field) => {
    const { post, sign, store } = await setup();
    if (field === "appId") store.registerApp({ appId: "other-app", publicKey: Buffer.from(keys.publicKey).toString("base64"), enabled: true });
    const event: Record<string, unknown> = { ...sign() };
    event[field] = field === "outcome" ? 1 : field === "timestamp" ? 1101 : field === "appId" ? "other-app" : "modified";
    expect((await post(event)).statusCode).toBe(401);
  });
  it("rejects unknown and disabled applications", async () => {
    const { post, sign, store } = await setup();
    expect((await post(sign({ appId: "unknown" }))).statusCode).toBe(403);
    store.registerApp({ appId: "racing-demo", publicKey: Buffer.from(keys.publicKey).toString("base64"), enabled: false });
    expect((await post(sign())).statusCode).toBe(403);
  });
  it("rejects unregistered and cross-application market IDs", async () => {
    const { post, sign, store } = await setup();
    expect((await post(sign({ marketId: "other-market" }))).json().error.code).toBe("UNAUTHORIZED_MARKET");
    store.registerApp({ appId: "other-app", publicKey: Buffer.from(keys.publicKey).toString("base64"), enabled: true });
    expect((await post(sign({ appId: "other-app" }))).json().error.code).toBe("UNAUTHORIZED_MARKET");
  });
  it("rejects event IDs without exact authorization", async () => {
    const { post, sign } = await setup();
    expect((await post(sign({ eventId: "race-42-unrelated" }))).json().error.code).toBe("UNAUTHORIZED_EVENT");
  });
  it("rejects events signed for another domain version", async () => {
    const { post, sign } = await setup();
    const event = sign();
    event.signature = Buffer.from(nacl.sign.detached(new TextEncoder().encode(JSON.stringify(["hunch:event:v2", event.appId, event.eventId, event.marketId, event.outcome, event.timestamp])), keys.secretKey)).toString("base64");
    expect((await post(event)).statusCode).toBe(401);
  });
  it.each([{}, { outcome: 2 }, { outcome: "0" }, { timestamp: 1100.5 }, { timestamp: "1100" }, { extra: true }, { publicKey: "caller-key" }, { signature: "invalid" }])("rejects malformed payload %j", async (change) => {
    const { post, sign } = await setup();
    const payload = Object.keys(change).length ? { ...sign(), ...change } : {};
    expect((await post(payload)).statusCode).toBe(400);
  });
  it("rejects noncanonical base64 even at the correct string length", async () => {
    const { post, sign } = await setup();
    const event = sign();
    event.signature = "!" + event.signature.slice(1);
    expect((await post(event)).statusCode).toBe(401);
  });
  it("rejects expired events and excessive future skew", async () => {
    const { post, sign, setTime } = await setup();
    setTime(1401);
    expect((await post(sign())).json().error.code).toBe("EVENT_EXPIRED");
    setTime(1100);
    expect((await post(sign({ timestamp: 1131 }))).json().error.code).toBe("EVENT_IN_FUTURE");
  });
  it.each([1100, 1400])("accepts timestamps at freshness boundary with current time %s", async (current) => {
    const { post, sign, setTime } = await setup();
    setTime(current);
    expect((await post(sign())).statusCode).toBe(200);
  });
  it("accepts the future skew boundary", async () => {
    const { post, sign } = await setup();
    expect((await post(sign({ timestamp: 1130 }))).statusCode).toBe(200);
  });
  it("requires a closed market and result timestamp at or after its deadline", async () => {
    const { post, sign, setTime } = await setup();
    setTime(1099);
    expect((await post(sign())).json().error.code).toBe("MARKET_INELIGIBLE");
    setTime(1100);
    expect((await post(sign({ timestamp: 1099 }))).json().error.code).toBe("MARKET_INELIGIBLE");
  });
  it("checks authoritative ownership, not just the registered market ID", async () => {
    const { post, sign } = await setup(":memory:", bob.publicKey.toBase58());
    expect((await post(sign())).json().error.code).toBe("MARKET_AUTHORITY_MISMATCH");
  });
  it("rejects a mismatched resolver signer", async () => {
    const s = await setup();
    const wrongSignerApp = buildServer({ adapter: s.adapter, store: s.store, signer: bob, clock: s.clock });
    cleanups.push(() => wrongSignerApp.close());
    expect((await wrongSignerApp.inject({ method: "POST", url: "/v1/events", payload: s.sign() })).json().error.code).toBe("MARKET_AUTHORITY_MISMATCH");
  });
  it("rejects a mapping whose adapter market does not exist", async () => {
    const { post, sign, store } = await setup();
    store.registerMarket({ appId: "racing-demo", marketId: "missing", eventId: "missing-finished", authority: creator.publicKey.toBase58(), resolverAuthority: resolver.publicKey.toBase58() });
    expect((await post(sign({ marketId: "missing", eventId: "missing-finished" }))).statusCode).toBe(404);
  });
  it("returns identical status for duplicates even after freshness expiry", async () => {
    const { post, sign, adapter, setTime } = await setup();
    const spy = vi.spyOn(adapter, "resolveMarket");
    const event = sign();
    const first = await post(event);
    setTime(9999);
    expect((await post(event)).json()).toEqual(first.json());
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("rejects changed payloads that reuse an accepted event ID", async () => {
    const { post, sign } = await setup();
    await post(sign());
    const response = await post(sign({ outcome: 1 }));
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("EVENT_CONFLICT");
  });
  it("reserves the event before awaiting resolution and prevents concurrent duplicates", async () => {
    const { post, sign, adapter, store } = await setup();
    let unblock!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const original = adapter.resolveMarket.bind(adapter);
    const spy = vi.spyOn(adapter, "resolveMarket").mockImplementation(async (...args) => {
      started(); await gate; return original(...args);
    });
    const first = post(sign());
    await entered;
    expect(store.getEvent("race-42-finished")?.status).toBe("processing");
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => post(sign())));
    expect(duplicates.every((response) => response.statusCode === 202 && response.json().status === "processing")).toBe(true);
    unblock();
    expect((await first).statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("stores failures without exposing internals or retrying duplicate requests", async () => {
    const { post, sign, adapter, store } = await setup();
    const spy = vi.spyOn(adapter, "resolveMarket").mockRejectedValue(new Error("private internal details"));
    const response = await post(sign());
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ status: "failed", error: { code: "RESOLUTION_FAILED", message: "Resolution failed" } });
    expect(response.body).not.toContain("private internal");
    expect(store.getEvent("race-42-finished")?.status).toBe("failed");
    expect((await post(sign())).statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("holds uncertain submissions for manual reconciliation and never retries", async () => {
    const { post, sign, adapter } = await setup();
    const spy = vi.spyOn(adapter, "resolveMarket").mockRejectedValue(new HunchError("TRANSACTION_UNCERTAIN", "RPC timed out"));
    expect((await post(sign())).json()).toMatchObject({ status: "submitted", transaction: null, error: { code: "TRANSACTION_UNCERTAIN" } });
    expect((await post(sign())).statusCode).toBe(202);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("does not automatically reprocess an event interrupted during processing", async () => {
    const { post, sign, adapter, store } = await setup();
    const event = sign();
    store.receive(event, payloadHash(event), "mock", 1100);
    store.updateEvent(event.eventId, "received", "processing", 1100);
    const spy = vi.spyOn(adapter, "resolveMarket");
    expect((await post(event)).json().status).toBe("processing");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("SQLite persistence", () => {
  it("persists registrations, mappings, event IDs and status across connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hunch-store-test-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const s = await setup(join(directory, "resolver.sqlite"));
    await s.post(s.sign());
    const reopened = new ResolverStore(join(directory, "resolver.sqlite"));
    try {
      expect(reopened.getApp("racing-demo")?.publicKey).toBe(Buffer.from(keys.publicKey).toString("base64"));
      expect(reopened.getMarketMapping("race-42")?.eventId).toBe("race-42-finished");
      expect(reopened.getEvent("race-42-finished")?.status).toBe("confirmed");
      expect(reopened.receive(s.sign(), payloadHash(s.sign()), "mock", 1101).created).toBe(false);
      expect(() => reopened.receive(s.sign({ outcome: 1 }), payloadHash(s.sign({ outcome: 1 })), "mock", 1101)).toThrow(/different payload/);
      expect(() => reopened.existingEvent("race-42-finished", payloadHash(s.sign()), "anchor")).toThrow(/different payload or mode/);
    } finally { reopened.close(); }
  });
  it("reserves only one event for a market and guards state transitions", async () => {
    const { store, sign } = await setup();
    const event = sign();
    store.receive(event, payloadHash(event), "mock", 1100);
    const other = sign({ eventId: "other-event" });
    expect(() => store.receive(other, payloadHash(other), "mock", 1100)).toThrow(/reserved result/);
    expect(() => store.updateEvent(event.eventId, "processing", "confirmed", 1100)).toThrow(/changed unexpectedly/);
    expect(store.getEvent(event.eventId)?.status).toBe("received");
  });
  it("validates registration keys and prevents silent market reassignment", async () => {
    const { store } = await setup();
    expect(() => store.registerApp({ appId: "bad", publicKey: "wrong", enabled: true })).toThrow(/base64/);
    expect(() => store.registerApp({ appId: "racing-demo", publicKey: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"), enabled: true })).toThrow(/different key/);
    const mapping = store.getMarketMapping("race-42")!;
    expect(() => store.registerMarket({ ...mapping, authority: bob.publicKey.toBase58() })).toThrow(/cannot be reassigned/);
  });
  it("accepts repeated mapping registration independent of property order", async () => {
    const { store } = await setup();
    const mapping = store.getMarketMapping("race-42")!;
    expect(() => store.registerMarket({ eventId: mapping.eventId, resolverAuthority: mapping.resolverAuthority,
      authority: mapping.authority, appId: mapping.appId, marketId: mapping.marketId })).not.toThrow();
  });
  it("retains processing records after closing and reopening the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "hunch-restart-test-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "resolver.sqlite");
    const store = new ResolverStore(path);
    try {
      store.registerApp({ appId: "racing-demo", publicKey: Buffer.from(keys.publicKey).toString("base64"), enabled: true });
      store.registerMarket({ appId: "racing-demo", marketId: "race-42", eventId: "race-42-finished", authority: creator.publicKey.toBase58(), resolverAuthority: resolver.publicKey.toBase58() });
      const event = { appId: "racing-demo", marketId: "race-42", eventId: "race-42-finished", outcome: 0 as const, timestamp: 1100, signature: "unused-in-storage-test" };
      store.receive(event, payloadHash(event), "mock", 1100);
      store.updateEvent(event.eventId, "received", "processing", 1100);
    } finally { store.close(); }
    const reopened = new ResolverStore(path);
    try {
      expect(reopened.getApp("racing-demo")?.enabled).toBe(true);
      expect(reopened.getMarketMapping("race-42")?.authority).toBe(creator.publicKey.toBase58());
      expect(reopened.getEvent("race-42-finished")?.status).toBe("processing");
      expect(reopened.pendingCount()).toBe(1);
    } finally { reopened.close(); }
  });
});

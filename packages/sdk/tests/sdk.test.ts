import { describe, it, expect, beforeEach } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  Hunch, MarketKit, MockMarketAdapter, AnchorMarketAdapter, createMockWallet, HunchError,
  canonicalEventPayload,
} from "../src/index.js";
import type { Outcome, CreateMarketParams } from "../src/index.js";

const wallet = (byte: number) => createMockWallet(new PublicKey(new Uint8Array(32).fill(byte)));
const creator = wallet(1), resolver = wallet(2), alice = wallet(3), bob = wallet(4), carol = wallet(5);
let now: number, adapter: MockMarketAdapter, owner: Hunch, a: Hunch, b: Hunch, r: Hunch;
const params = (): CreateMarketParams => ({ id: "race-42", question: "Who wins?", outcomes: ["Alice", "Bob"], closesAt: 1100 });
const create = () => owner.createMarket(params());

beforeEach(() => {
  now = 1000;
  adapter = new MockMarketAdapter({ resolverAuthority: resolver.publicKey.toBase58(), authorizedCreators: [creator.publicKey.toBase58()], clock: () => now });
  owner = new Hunch({ adapter, wallet: creator });
  a = new Hunch({ adapter, wallet: alice });
  b = new Hunch({ adapter, wallet: bob });
  r = new Hunch({ adapter, wallet: resolver });
});

describe("SDK foundation and mock", () => {
  it("creates, retrieves, lists and filters markets; metadata is separate", async () => {
    const result = await create();
    expect(result.market.metadata).toEqual({ question: "Who wins?", outcomes: ["Alice", "Bob"], description: undefined });
    expect(result.signature).toBeNull();
    expect(result.transaction).toMatchObject({ mode: "mock", id: "mock:1", signature: null, status: "confirmed" });
    expect((await owner.getMarket("race-42"))?.totalPool).toBe(0n);
    expect(await owner.getMarket("missing")).toBeNull();
    expect(await owner.listMarkets({ authority: creator.publicKey.toBase58(), status: "open" })).toHaveLength(1);
    expect(await owner.listMarkets({ authority: alice.publicKey.toBase58() })).toHaveLength(0);
    now = 1100;
    expect((await owner.getMarket("race-42"))?.status).toBe("closed");
    expect(await owner.listMarkets({ status: "closed" })).toHaveLength(1);
  });
  it("allocates deterministic noncolliding IDs", async () => {
    await owner.createMarket({ ...params(), id: "mock-market-1" });
    expect((await owner.createMarket({ ...params(), id: undefined })).market.id).toBe("mock-market-2");
  });
  it("rejects unauthorized creation and duplicate IDs", async () => {
    await expect(a.createMarket(params())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await create();
    await expect(create()).rejects.toMatchObject({ code: "MARKET_EXISTS" });
    await expect(owner.createMarket({ ...params(), resolverAuthority: alice.publicKey.toBase58() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it.each([1000, 999, 1000.5, NaN, Infinity])("rejects invalid deadline %s", async (closesAt) => {
    await expect(owner.createMarket({ ...params(), closesAt })).rejects.toMatchObject({ code: "INVALID_DEADLINE" });
  });
  it("rejects malformed metadata and identifiers", async () => {
    await expect(owner.createMarket({ ...params(), question: " " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(owner.createMarket({ ...params(), outcomes: ["A"] as unknown as [string, string] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(owner.createMarket({ ...params(), id: "" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it.each([0n, -1n, 1, "5", 1.5, NaN])("rejects invalid stake %s without changing pools", async (amount) => {
    await create();
    await expect(a.predict({ marketId: "race-42", outcome: 0, amount: amount as bigint })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect((await a.getMarket("race-42"))?.totalPool).toBe(0n);
  });
  it("rejects invalid outcomes and unknown markets", async () => {
    await create();
    await expect(a.predict({ marketId: "race-42", outcome: 2 as Outcome, amount: 1n })).rejects.toMatchObject({ code: "INVALID_OUTCOME" });
    await expect(a.predict({ marketId: "missing", outcome: 0, amount: 1n })).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
    await expect(a.getPositions("missing")).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
  });
  it("tracks multiple wallets, both outcomes and repeated predictions", async () => {
    await create();
    await a.predict({ marketId: "race-42", outcome: 0, amount: 10n });
    await a.predict({ marketId: "race-42", outcome: 0, amount: 5n });
    await a.predict({ marketId: "race-42", outcome: 1, amount: 2n });
    await b.predict({ marketId: "race-42", outcome: 1, amount: 20n });
    expect((await a.getPositions("race-42"))[0].amount).toBe(15n);
    expect(await a.getPositions("race-42")).toHaveLength(2);
    expect(await new Hunch({ adapter }).getPositions("race-42")).toHaveLength(3);
    expect(await a.getPositions("race-42", bob.publicKey.toBase58())).toHaveLength(1);
    expect((await a.getMarket("race-42"))?.pools).toEqual([15n, 22n]);
  });
  it("returns defensive copies of inputs, markets, positions and receipts", async () => {
    const input = params();
    const result = await owner.createMarket(input);
    input.outcomes[0] = "Changed";
    result.market.pools[0] = 999n;
    result.market.metadata!.outcomes[0] = "Changed too";
    result.transaction.id = "mutated";
    const prediction = await a.predict({ marketId: "race-42", outcome: 0, amount: 5n });
    prediction.position.amount = 999n;
    const positions = await a.getPositions("race-42");
    positions[0].claimed = true;
    expect((await a.getMarket("race-42"))?.metadata?.outcomes[0]).toBe("Alice");
    expect((await a.getMarket("race-42"))?.pools).toEqual([5n, 0n]);
    expect((await a.getPositions("race-42"))[0]).toMatchObject({ amount: 5n, claimed: false });
    expect((await a.getTransactionStatus("mock:1")).status).toBe("confirmed");
  });
  it("enforces deadline, resolution authority, valid winner and one-time resolution", async () => {
    await create();
    await expect(r.resolveMarket("race-42", 0)).rejects.toMatchObject({ code: "MARKET_NOT_CLOSED" });
    now = 1100;
    await expect(a.predict({ marketId: "race-42", outcome: 0, amount: 1n })).rejects.toMatchObject({ code: "MARKET_CLOSED" });
    await expect(a.resolveMarket("race-42", 0)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(r.resolveMarket("race-42", 2 as Outcome)).rejects.toMatchObject({ code: "INVALID_OUTCOME" });
    await r.resolveMarket("race-42", 0);
    await expect(r.resolveMarket("race-42", 1)).rejects.toMatchObject({ code: "MARKET_RESOLVED" });
    await expect(a.predict({ marketId: "race-42", outcome: 0, amount: 1n })).rejects.toMatchObject({ code: "MARKET_CLOSED" });
  });
  it("pays proportional winners, keeps rounding dust, and prevents double claims", async () => {
    await create();
    const c = new Hunch({ adapter, wallet: carol });
    await a.predict({ marketId: "race-42", outcome: 0, amount: 1n });
    await c.predict({ marketId: "race-42", outcome: 0, amount: 2n });
    await b.predict({ marketId: "race-42", outcome: 1, amount: 7n });
    await expect(a.claimWinnings("race-42")).rejects.toMatchObject({ code: "MARKET_NOT_RESOLVED" });
    now = 1100;
    await r.resolveMarket("race-42", 0);
    expect((await a.claimWinnings("race-42")).payout).toBe(3n);
    expect((await c.claimWinnings("race-42")).payout).toBe(6n);
    expect((await a.getPositions("race-42"))[0]).toMatchObject({ claimed: true, payout: 3n });
    await expect(a.claimWinnings("race-42")).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });
    await expect(b.claimWinnings("race-42")).rejects.toMatchObject({ code: "NO_WINNING_POSITION" });
  });
  it("uses bigint without numeric precision loss", async () => {
    await create();
    const huge = 2n ** 100n;
    await a.predict({ marketId: "race-42", outcome: 1, amount: huge });
    await b.predict({ marketId: "race-42", outcome: 0, amount: huge });
    now = 1100;
    await r.resolveMarket("race-42", 1);
    expect((await a.claimWinnings("race-42")).payout).toBe(huge * 2n);
  });
  it("handles empty markets and outcomes with no winners", async () => {
    await create();
    now = 1100;
    await r.resolveMarket("race-42", 1);
    await expect(a.claimWinnings("race-42")).rejects.toMatchObject({ code: "NO_WINNING_POSITION" });
    expect((await r.getMarket("race-42"))?.totalPool).toBe(0n);
  });
  it("looks up mock receipts and unknown transaction IDs", async () => {
    const result = await create();
    expect(await owner.getTransactionStatus(result.transaction.id)).toMatchObject({ mode: "mock", signature: null, status: "confirmed" });
    expect((await owner.getTransactionStatus("missing")).status).toBe("not_found");
  });
  it("requires a wallet for mutations on an injected adapter", async () => {
    expect(() => new Hunch({ adapter }).createMarket(params())).toThrow(HunchError);
  });
  it("preserves MarketKit class compatibility and rejects signing with mock wallets", async () => {
    const legacy = new MarketKit({ mock: true, clock: () => 1000 });
    expect((await legacy.createMarket(params())).market.question).toBe("Who wins?");
    await expect(alice.signTransaction({} as never)).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
  });
  it("constructs read-only real mode and rejects conflicting configuration", () => {
    expect(new AnchorMarketAdapter().mode).toBe("anchor");
    expect(new Hunch({ mock: false }).adapter.mode).toBe("anchor");
    expect(() => new Hunch({ mode: "anchor", adapter })).toThrow(/does not match/);
    expect(() => new Hunch({ mode: "anchor", mock: true })).toThrow(/disagree/);
  });
  it("canonicalizes independently of property order with versioned domain separation", () => {
    const payload = { appId: "racing-demo", eventId: "race-42-finished", marketId: "race-42", outcome: 0 as const, timestamp: 1100 };
    const expected = '["hunch:event:v1","racing-demo","race-42-finished","race-42",0,1100]';
    expect(new TextDecoder().decode(canonicalEventPayload(payload))).toBe(expected);
    expect(canonicalEventPayload({ timestamp: 1100, outcome: 0, marketId: "race-42", eventId: "race-42-finished", appId: "racing-demo" })).toEqual(canonicalEventPayload(payload));
  });
});

import { describe, it, expect, vi } from "vitest";
import { MockHunchClient, DEMO_WALLET } from "../adapters/MockHunchClient";

const storageKey = "hunch.frontend.demo.v1";
describe("persisted demo state", () => {
  it.each(["null", "{}", "[]", "{invalid json"])(
    "recovers from malformed state %s",
    async (saved) => {
      localStorage.setItem(storageKey, saved);
      const mock = new MockHunchClient({ latencyMs: 0 });
      expect((await mock.getMarket("race-42")).totalPool).toBe(1000n);
      expect(await mock.getTokenBalance(DEMO_WALLET)).toBe(1000n);
    },
  );
  it("restores valid bigint stakes and balances", async () => {
    const first = new MockHunchClient({ latencyMs: 0 });
    await first.predict({
      marketId: "race-42",
      outcome: 0,
      amount: 17n,
      walletAddress: DEMO_WALLET,
    });
    const restored = new MockHunchClient({ latencyMs: 0 });
    expect((await restored.getMarket("race-42")).totalPool).toBe(1017n);
    expect(await restored.getTokenBalance(DEMO_WALLET)).toBe(983n);
    expect(
      (await restored.getPositions("race-42", DEMO_WALLET))[0],
    ).toMatchObject({ amount: 17n, claimed: false });
  });
  async function savedStake(amount = 17n) {
    const client = new MockHunchClient({ latencyMs: 0 });
    await client.predict({
      marketId: "race-42",
      outcome: 0,
      amount,
      walletAddress: DEMO_WALLET,
    });
    return localStorage.getItem(storageKey)!;
  }
  it("moves a previous namespace ledger without losing positions or events", async () => {
    const previousKey = "previous.frontend.demo.v1";
    const saved = await savedStake();
    localStorage.setItem(previousKey, saved);
    localStorage.removeItem(storageKey);

    const restored = new MockHunchClient({ latencyMs: 0 });
    expect((await restored.getMarket("race-42")).totalPool).toBe(1017n);
    expect(await restored.getTokenBalance(DEMO_WALLET)).toBe(983n);
    expect(
      (await restored.getPositions("race-42", DEMO_WALLET))[0],
    ).toMatchObject({
      amount: 17n,
      claimed: false,
    });
    expect((await restored.getEvents())[0].type).toBe("prediction");
    expect(localStorage.getItem(storageKey)).toBe(saved);
    expect(localStorage.getItem(previousKey)).toBeNull();
  });
  it("prefers the hunch ledger over an earlier snapshot", async () => {
    localStorage.setItem("previous.frontend.demo.v1", await savedStake());
    await savedStake(5n);

    const restored = new MockHunchClient({ latencyMs: 0 });
    expect(await restored.getTokenBalance(DEMO_WALLET)).toBe(978n);
    expect(localStorage.getItem("previous.frontend.demo.v1")).not.toBeNull();
  });
  it("skips malformed snapshots and unrelated storage entries", async () => {
    const saved = await savedStake();
    localStorage.removeItem(storageKey);
    localStorage.setItem("unrelated.application", saved);
    localStorage.setItem("corrupt.frontend.demo.v1", "{invalid json");
    localStorage.setItem("previous.frontend.demo.v1", saved);

    const restored = new MockHunchClient({ latencyMs: 0 });
    expect(await restored.getTokenBalance(DEMO_WALLET)).toBe(983n);
    expect(localStorage.getItem("unrelated.application")).toBe(saved);
    expect(localStorage.getItem("corrupt.frontend.demo.v1")).toBe(
      "{invalid json",
    );
  });
  it("leaves ambiguous previous ledgers untouched", async () => {
    const saved = await savedStake();
    localStorage.removeItem(storageKey);
    localStorage.setItem("first.frontend.demo.v1", saved);
    localStorage.setItem("second.frontend.demo.v1", saved);

    const restored = new MockHunchClient({ latencyMs: 0 });
    expect(await restored.getTokenBalance(DEMO_WALLET)).toBe(1000n);
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(localStorage.getItem("first.frontend.demo.v1")).toBe(saved);
    expect(localStorage.getItem("second.frontend.demo.v1")).toBe(saved);
  });
  it("preserves the previous ledger if writing the new key fails", async () => {
    const saved = await savedStake();
    const previousKey = "previous.frontend.demo.v1";
    localStorage.removeItem(storageKey);
    localStorage.setItem(previousKey, saved);
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage is full");
      });
    let restored: MockHunchClient;
    try {
      restored = new MockHunchClient({ latencyMs: 0 });
    } finally {
      write.mockRestore();
    }
    expect(await restored.getTokenBalance(DEMO_WALLET)).toBe(983n);
    expect(localStorage.getItem(previousKey)).toBe(saved);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it.each(["pools", "positions", "balances", "races", "events"])(
    "rejects structurally corrupt %s without breaking future actions",
    async (field) => {
      const first = new MockHunchClient({ latencyMs: 0 });
      await first.predict({
        marketId: "race-42",
        outcome: 0,
        amount: 17n,
        walletAddress: DEMO_WALLET,
      });
      const saved = JSON.parse(localStorage.getItem(storageKey)!);
      if (field === "pools") saved.markets[0].pools[0] = "not-a-bigint";
      if (field === "positions") saved.positions[0].outcome = 7;
      if (field === "balances") saved.balances[DEMO_WALLET] = 983;
      if (field === "races") saved.races["race-42"] = { status: "racing" };
      if (field === "events") saved.events[0].timestamp = "yesterday";
      localStorage.setItem(storageKey, JSON.stringify(saved));
      const recovered = new MockHunchClient({ latencyMs: 0 });
      expect(await recovered.getTokenBalance(DEMO_WALLET)).toBe(1000n);
      await recovered.predict({
        marketId: "race-42",
        outcome: 1,
        amount: 5n,
        walletAddress: DEMO_WALLET,
      });
      expect(await recovered.getTokenBalance(DEMO_WALLET)).toBe(995n);
    },
  );
});

import { describe, it, expect } from "vitest";
import {
  MockMarketKitClient,
  DEMO_WALLET,
} from "../adapters/MockMarketKitClient";

const storageKey = "marketkit.frontend.demo.v1";
describe("persisted demo state", () => {
  it.each(["null", "{}", "[]", "{invalid json"])(
    "recovers from malformed state %s",
    async (saved) => {
      localStorage.setItem(storageKey, saved);
      const mock = new MockMarketKitClient({ latencyMs: 0 });
      expect((await mock.getMarket("race-42")).totalPool).toBe(1000n);
      expect(await mock.getTokenBalance(DEMO_WALLET)).toBe(1000n);
    },
  );
  it("restores valid bigint stakes and balances", async () => {
    const first = new MockMarketKitClient({ latencyMs: 0 });
    await first.predict({
      marketId: "race-42",
      outcome: 0,
      amount: 17n,
      walletAddress: DEMO_WALLET,
    });
    const restored = new MockMarketKitClient({ latencyMs: 0 });
    expect((await restored.getMarket("race-42")).totalPool).toBe(1017n);
    expect(await restored.getTokenBalance(DEMO_WALLET)).toBe(983n);
    expect(
      (await restored.getPositions("race-42", DEMO_WALLET))[0],
    ).toMatchObject({ amount: 17n, claimed: false });
  });
  it.each(["pools", "positions", "balances", "races", "events"])(
    "rejects structurally corrupt %s without breaking future actions",
    async (field) => {
      const first = new MockMarketKitClient({ latencyMs: 0 });
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
      const recovered = new MockMarketKitClient({ latencyMs: 0 });
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

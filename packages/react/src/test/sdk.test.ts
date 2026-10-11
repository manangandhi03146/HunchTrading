import { describe, expect, it, vi } from "vitest";
import { LegacyHunch as Hunch, type Outcome } from "@hunch/sdk";

function setup() {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const client = new Hunch({ mock: undefined, rpcUrl: undefined });
  const params = {
    question: "Who wins?",
    outcomes: ["A", "B"] as [string, string],
    closesAt: 1_800_000_060,
  };
  return { clock, client, params };
}
describe("SDK mock lifecycle", () => {
  it("uses defaults for undefined config and validates market creation", async () => {
    const { client, params } = setup();
    for (const invalid of [
      { ...params, question: " " },
      { ...params, outcomes: [" A", "a "] as [string, string] },
      { ...params, closesAt: NaN },
      { ...params, closesAt: 1_800_000_000 },
      { ...params, closesAt: params.closesAt + 0.5 },
    ])
      await expect(client.createMarket(invalid)).rejects.toThrow();
    expect((await client.createMarket(params)).market.status).toBe("open");
    await expect(
      new Hunch({ mock: false }).createMarket(params),
    ).rejects.toThrow("real impl pending");
  });
  it("rejects invalid stakes without changing positions or pools", async () => {
    const { client, params } = setup();
    const { market } = await client.createMarket(params);
    const before = await client.getMarket(market.id);
    for (const invalid of [
      { outcome: 0 as Outcome, amount: -1n },
      { outcome: 0 as Outcome, amount: 0n },
      { outcome: 0 as Outcome, amount: 1 as unknown as bigint },
      { outcome: 2 as Outcome, amount: 10n },
    ]) {
      await expect(
        client.predict({ marketId: market.id, ...invalid }),
      ).rejects.toThrow();
      expect(await client.getMarket(market.id)).toEqual(before);
      expect(await client.getPositions(market.id)).toEqual([]);
    }
  });
  it("closes exactly at the deadline without requiring a preceding read", async () => {
    const { clock, client, params } = setup();
    const { market } = await client.createMarket(params);
    clock.mockReturnValue(params.closesAt * 1000);
    await expect(
      client.predict({ marketId: market.id, outcome: 0, amount: 1n }),
    ).rejects.toThrow("closed");
    expect(await client.getPositions(market.id)).toEqual([]);
    expect(await client.getMarket(market.id)).toMatchObject({
      status: "closed",
      pools: [0n, 0n],
      totalPool: 0n,
    });
    await client.resolveMarket(market.id, 0);
    expect((await client.getMarket(market.id))?.status).toBe("resolved");
  });
  it("rejects early or invalid resolution without changing the market", async () => {
    const { clock, client, params } = setup();
    const { market } = await client.createMarket(params);
    await expect(client.resolveMarket(market.id, 0)).rejects.toThrow("close");
    expect(await client.getMarket(market.id)).toEqual(market);
    clock.mockReturnValue(params.closesAt * 1000);
    const closed = await client.getMarket(market.id);
    await expect(client.resolveMarket(market.id, 2 as Outcome)).rejects.toThrow(
      "outcome",
    );
    expect(await client.getMarket(market.id)).toEqual(closed);
  });
  it("accumulates exact stakes and pays only one concurrent claim", async () => {
    const { clock, client, params } = setup();
    const { market } = await client.createMarket(params);
    const largeStake = 9_007_199_254_740_993n;
    await client.predict({
      marketId: market.id,
      outcome: 0,
      amount: largeStake,
    });
    await client.predict({ marketId: market.id, outcome: 0, amount: 2n });
    await client.predict({ marketId: market.id, outcome: 1, amount: 5n });
    expect((await client.getPositions(market.id))[0].amount).toBe(
      largeStake + 2n,
    );
    await expect(client.claimWinnings(market.id)).rejects.toThrow(
      "not resolved",
    );
    clock.mockReturnValue(params.closesAt * 1000);
    await client.resolveMarket(market.id, 0);
    const resolved = await client.getMarket(market.id);
    await expect(client.resolveMarket(market.id, 1)).rejects.toThrow(
      "finalized",
    );
    await expect(
      client.predict({ marketId: market.id, outcome: 0, amount: 1n }),
    ).rejects.toThrow("closed");
    expect(await client.getMarket(market.id)).toEqual(resolved);
    const results = await Promise.allSettled([
      client.claimWinnings(market.id),
      client.claimWinnings(market.id),
    ]);
    expect(results[0]).toEqual({
      status: "fulfilled",
      value: { payout: largeStake + 7n, signature: "MOCK_SIGNATURE" },
    });
    expect(results[1].status).toBe("rejected");
    await expect(client.claimWinnings(market.id)).rejects.toThrow(
      "already claimed",
    );
    expect(await client.getMarket(market.id)).toEqual(resolved);
  });
  it("does not pay a losing position or an empty winning pool", async () => {
    const { clock, client, params } = setup();
    const { market } = await client.createMarket(params);
    await client.predict({ marketId: market.id, outcome: 1, amount: 5n });
    clock.mockReturnValue(params.closesAt * 1000);
    await client.resolveMarket(market.id, 0);
    await expect(client.claimWinnings(market.id)).rejects.toThrow(
      "no winning position",
    );
    expect((await client.getMarket(market.id))?.totalPool).toBe(5n);
  });
  it("isolates storage from mutation of requests and returned objects", async () => {
    const { client, params } = setup();
    const { market } = await client.createMarket(params);
    params.outcomes[0] = "changed request";
    market.outcomes[1] = "changed response";
    market.pools[0] = 999n;
    market.totalPool = 999n;
    market.winningOutcome = 1;
    const read = (await client.getMarket(market.id))!;
    expect(read).toMatchObject({
      outcomes: ["A", "B"],
      pools: [0n, 0n],
      totalPool: 0n,
      winningOutcome: null,
    });
    read.pools[1] = 123n;
    read.outcomes[0] = "changed read";
    const { position } = await client.predict({
      marketId: market.id,
      outcome: 0,
      amount: 10n,
    });
    position.amount = 999n;
    const positions = await client.getPositions(market.id);
    expect(positions[0].amount).toBe(10n);
    positions[0].amount = 1n;
    expect((await client.getPositions(market.id))[0].amount).toBe(10n);
    expect(await client.getMarket(market.id)).toMatchObject({
      outcomes: ["A", "B"],
      pools: [10n, 0n],
      totalPool: 10n,
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  demoReducer as act,
  initialDemo,
  FEE,
  LAMPORTS,
  loadDemo,
  payout,
  quoteSwap,
} from "./model";
function funded() {
  return [{ type: "connect" }, { type: "faucet" }, { type: "grant" }].reduce(
    (s, a) => act(s, a as Parameters<typeof act>[1]),
    initialDemo(),
  );
}
describe("exhibition ledger", () => {
  it("requires connection and SOL before a token grant", () => {
    const initial = initialDemo();
    expect(act(initial, { type: "grant" })).toBe(initial);
    expect(act(initial, { type: "faucet" })).toBe(initial);
    const connected = act(initial, { type: "connect" });
    expect(act(connected, { type: "grant" })).toBe(connected);
  });
  it("grants finite funding once and accounts for the fee", () => {
    const s = funded();
    expect(s.tokens).toBe(1000);
    expect(s.sol).toBe(LAMPORTS / 4 - FEE);
    expect(act(s, { type: "grant" })).toBe(s);
    expect(act(s, { type: "faucet" })).toBe(s);
  });
  it("records a stake and moves exactly the same tokens into the pool", () => {
    const s = funded();
    const next = act(s, { type: "stake", side: 0, amount: 100 });
    expect(next.tokens).toBe(900);
    expect(next.pool[0] - s.pool[0]).toBe(100);
    expect(next.position).toEqual([100, 0]);
    expect(s.sol - next.sol).toBe(FEE);
  });
  it("accumulates stakes on both sides without changing the wrong pool", () => {
    let s = act(funded(), { type: "stake", side: 0, amount: 100 });
    s = act(s, { type: "stake", side: 0, amount: 200 });
    s = act(s, { type: "stake", side: 1, amount: 250 });
    expect(s.position).toEqual([300, 250]);
    expect(s.pool).toEqual([6500, 4050]);
    expect(s.tokens).toBe(450);
  });
  it.each([0, -1, 0.5, NaN, Infinity, 1001])(
    "rejects invalid or unaffordable stake %s without mutation",
    (amount) => {
      const s = funded();
      expect(act(s, { type: "stake", side: 0, amount })).toBe(s);
    },
  );
  it("rejects unfunded fee balance and invalid outcome", () => {
    const s = { ...funded(), sol: 0 };
    expect(act(s, { type: "stake", side: 0, amount: 100 })).toBe(s);
    const f = funded();
    expect(act(f, { type: "stake", side: 2 as 0, amount: 100 })).toBe(f);
  });
  it.each([
    [9, 0],
    [10, 1],
    [11, 1],
  ])("models placement #%s as outcome %s", (placement, winner) => {
    let s = act(funded(), { type: "stake", side: 0, amount: 100 });
    s = act(s, { type: "resolve", placement });
    expect(payout(s) > 0).toBe(winner === 0);
    expect(act(s, { type: "stake", side: 1, amount: 100 })).toBe(s);
  });
  it("rejects invalid placements and a changed result", () => {
    const s = funded();
    for (const placement of [0, 101, NaN, 9.5])
      expect(act(s, { type: "resolve", placement })).toBe(s);
    const resolved = act(s, { type: "resolve", placement: 9 });
    expect(act(resolved, { type: "resolve", placement: 11 })).toBe(resolved);
  });
  it("computes proportional rounded payout and permits only one winning claim", () => {
    let s = act(funded(), { type: "stake", side: 0, amount: 100 });
    expect(act(s, { type: "claim" })).toBe(s);
    s = act(s, { type: "resolve", placement: 9 });
    expect(payout(s)).toBe(Math.floor((100 * 10100) / 6300));
    const next = act(s, { type: "claim" });
    expect(next.tokens - s.tokens).toBe(payout(s));
    expect(s.sol - next.sol).toBe(FEE);
    expect(act(next, { type: "claim" })).toBe(next);
  });
  it("rejects losing claims", () => {
    let s = act(funded(), { type: "stake", side: 1, amount: 100 });
    s = act(s, { type: "resolve", placement: 9 });
    expect(act(s, { type: "claim" })).toBe(s);
  });
  it("applies skipped crowd ticks once, even after seeking backward", () => {
    const s = act(initialDemo(), { type: "tick", tick: 25, second: 100 });
    expect(s.tick).toBe(25);
    expect(s.history).toHaveLength(26);
    expect(act(s, { type: "tick", tick: 25, second: 100 })).toBe(s);
    expect(act(s, { type: "tick", tick: 2, second: 8 })).toBe(s);
    const resolved = act(s, { type: "resolve", placement: 9 });
    expect(act(resolved, { type: "cue", cue: "fight", bias: 99 })).toBe(
      resolved,
    );
  });
  it("models AMM reserves and user balance conservation", () => {
    const s = funded();
    const input = 10_000_000;
    const output = quoteSwap(s, input);
    const next = act(s, { type: "swap", input });
    expect(output).toBe(99);
    expect(s.sol - next.sol).toBe(input + FEE);
    expect(next.tokens - s.tokens).toBe(output);
    expect(next.exchangeSol - s.exchangeSol).toBe(input);
    expect(s.exchangeTokens - next.exchangeTokens).toBe(output);
    expect(next.exchangeSol * next.exchangeTokens).toBeGreaterThanOrEqual(
      s.exchangeSol * s.exchangeTokens,
    );
  });
  it("rejects invalid or unaffordable swaps without consuming funds", () => {
    const s = funded();
    for (const input of [0, -1, NaN, 0.5, 2 * LAMPORTS, s.sol])
      expect(act(s, { type: "swap", input })).toBe(s);
  });
  it("restores a valid ledger and resets corrupt persisted data", () => {
    const s = funded();
    expect(loadDemo(JSON.stringify(s))).toEqual(s);
    expect(loadDemo("broken")).toEqual(initialDemo());
    expect(loadDemo(JSON.stringify({ ...s, tokens: -1 }))).toEqual(
      initialDemo(),
    );
    expect(loadDemo(JSON.stringify({ ...s, activity: [null] }))).toEqual(
      initialDemo(),
    );
  });
  it("keeps receipt identifiers unique after the history reaches its cap", () => {
    let s = funded();
    for (let i = 0; i < 150; i++)
      s = act(s, { type: "stake", side: 0, amount: 1 });
    expect(s.receipts).toHaveLength(100);
    expect(new Set(s.receipts.map((r) => r.id)).size).toBe(100);
  });
});

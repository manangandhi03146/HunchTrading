import { describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { Hunch, HttpMockMarketAdapter } from "../src/index.js";

const session = {
  mode: "mock" as const, simulated: true as const, sessionToken: "issued-simulated-session-token-for-tests",
  wallet: new PublicKey(new Uint8Array(32).fill(7)).toBase58(), label: "Simulated player",
};
const market = {
  id: "race-42", authority: session.wallet, resolverAuthority: session.wallet, tokenMint: null,
  closesAt: 1100, status: "open", totalPool: "9007199254740993", pools: ["9007199254740993", "0"], winningOutcome: null,
  metadata: { question: "123", outcomes: ["1", "2"] }, question: "123", outcomes: ["1", "2"],
};
const response = (fields: object, status = 200) => new Response(JSON.stringify({ mode: "mock", simulated: true, ...fields }), { status });

describe("HTTP mock SDK boundary", () => {
  it("issues a simulated session without sending a wallet address and sends scoped credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(session, 201)).mockResolvedValueOnce(response({ markets: [] }));
    const adapter = await HttpMockMarketAdapter.connect({ baseUrl: "http://localhost:8787", accessToken: "demo-admission-token", label: "Player", fetch: fetcher });
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ label: "Player" });
    expect(adapter.session?.simulated).toBe(true);
    await new Hunch({ adapter, wallet: adapter.wallet }).listMarkets();
    const headers = fetcher.mock.calls[1][1]!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer demo-admission-token");
    expect(headers["x-hunch-mock-session"]).toBe(session.sessionToken);
  });
  it("decodes only known bigint fields and preserves numeric metadata strings", async () => {
    const adapter = new HttpMockMarketAdapter({ baseUrl: "http://localhost:8787", fetch: async () => response({ market }) });
    const decoded = await adapter.getMarket("race-42");
    expect(decoded?.totalPool).toBe(9007199254740993n);
    expect(decoded?.metadata?.question).toBe("123");
    expect(decoded?.metadata?.outcomes).toEqual(["1", "2"]);
  });
  it.each([12, "01", "-1", "1e3", "1.5"])("rejects malformed amount in a response: %s", async (totalPool) => {
    const adapter = new HttpMockMarketAdapter({ baseUrl: "http://localhost:8787", fetch: async () => response({ market: { ...market, totalPool } }) });
    await expect(adapter.getMarket("race-42")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects a real-mode or unmarked response rather than claiming a mock success", async () => {
    const adapter = new HttpMockMarketAdapter({ baseUrl: "http://localhost:8787", fetch: async () => response({ mode: "anchor", market }) });
    await expect(adapter.getMarket("race-42")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("preserves useful SDK errors returned over HTTP", async () => {
    const adapter = new HttpMockMarketAdapter({ baseUrl: "http://localhost:8787", session, fetch: async () => new Response(JSON.stringify({ error: { code: "ALREADY_CLAIMED", message: "Already claimed" } }), { status: 409 }) });
    await expect(adapter.claimWinnings("race-42", adapter.wallet!)).rejects.toMatchObject({ code: "ALREADY_CLAIMED", details: { status: 409 } });
  });
  it("never retries a prediction after an uncertain network failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network unavailable"));
    const adapter = new HttpMockMarketAdapter({ baseUrl: "http://localhost:8787", session, fetch: fetcher });
    await expect(adapter.predict({ marketId: "race-42", outcome: 0, amount: 1n }, adapter.wallet!)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ outcome: 0, amount: "1" });
  });
  it("rejects unsupported URLs and unsafe mode combinations", () => {
    expect(() => new HttpMockMarketAdapter({ baseUrl: "https://name:secret@example.com" })).toThrow(/without credentials/);
    expect(() => new HttpMockMarketAdapter({ baseUrl: "https://example.com/path" })).toThrow(/without credentials/);
    const adapter = new HttpMockMarketAdapter({ baseUrl: "http://localhost:8787" });
    expect(() => new Hunch({ mode: "anchor", adapter })).toThrow(/does not match/);
  });
  it("does not allow remote resolution or a mutation without an issued identity", async () => {
    const adapter = new HttpMockMarketAdapter({ baseUrl: "http://localhost:8787", session });
    await expect(adapter.resolveMarket("race-42", 0, adapter.wallet!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const readOnly = new HttpMockMarketAdapter({ baseUrl: "http://localhost:8787" });
    await expect(readOnly.predict({ marketId: "race-42", outcome: 0, amount: 1n }, adapter.wallet!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

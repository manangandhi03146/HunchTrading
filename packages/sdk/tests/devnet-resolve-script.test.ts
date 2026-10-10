import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, realpath, stat } from "node:fs/promises";
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { Hunch, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER, HUNCH_PROGRAM_ID } from "../dist/index.js";
import type { Market } from "../dist/index.js";
import { main } from "../scripts/devnet-resolve.mjs";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), realpath: vi.fn(), stat: vi.fn() }));
// The approved resolver's secret is never available to tests. Happy paths substitute a public-key-only
// stand-in for the parsed keypair; resolveMarket is mocked, so nothing is ever signed.
let resolverKeys: Keypair, market: Market, args: string[], clusterTime: number, resolverLamports: number, keyMode: number;
const SYSVAR_OWNER = new PublicKey("Sysvar1111111111111111111111111111111111111");
function clockInfo() {
  const data = Buffer.alloc(40); data.writeBigInt64LE(BigInt(clusterTime), 32);
  return { data, owner: SYSVAR_OWNER, executable: false, lamports: 1, rentEpoch: 0 };
}
beforeEach(() => {
  resolverKeys = Keypair.generate();
  market = { id: Keypair.generate().publicKey.toBase58(), authority: Keypair.generate().publicKey.toBase58(), resolverAuthority: HUNCH_DEVNET_RESOLVER,
    tokenMint: HUNCH_DEVNET_TOKEN_MINT, closesAt: 1000, status: "closed", pools: [30n, 70n], totalPool: 100n, winningOutcome: null, metadata: null };
  clusterTime = 1500; resolverLamports = 1000000; keyMode = 0o100600;
  args = ["--market", market.id, "--outcome", "1"];
  vi.mocked(realpath).mockReset().mockImplementation(async path => path === "/outside/resolver.json" ? "/outside/resolver.json" : String(path));
  vi.mocked(stat).mockReset().mockImplementation(async () => ({ isFile: () => true, mode: keyMode }) as never);
  vi.mocked(readFile).mockReset().mockResolvedValue(JSON.stringify(Array.from(resolverKeys.secretKey)));
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  vi.spyOn(Connection.prototype, "getBalance").mockImplementation(async () => resolverLamports);
  vi.spyOn(Connection.prototype, "getAccountInfo").mockImplementation(async key => (key.equals(SYSVAR_CLOCK_PUBKEY) ? clockInfo() : null) as never);
  vi.spyOn(Connection.prototype, "sendRawTransaction").mockRejectedValue(new Error("Tests must not submit to RPC"));
  vi.spyOn(Hunch.prototype, "getMarket").mockImplementation(async () => market);
  vi.spyOn(Hunch.prototype, "resolveMarket").mockRejectedValue(new Error("Unexpected resolution"));
});
afterEach(() => vi.restoreAllMocks());
const output = (index = 0) => JSON.parse(vi.mocked(console.log).mock.calls[index][0] as string);
const authorized = () => [...args, "--authorize-devnet-resolution", "--keypair", "/outside/resolver.json"];
const expectNoKeyOrResolution = () => { expect(readFile).not.toHaveBeenCalled(); expect(Hunch.prototype.resolveMarket).not.toHaveBeenCalled(); };
const useEphemeralResolver = () => { vi.spyOn(Keypair, "fromSecretKey").mockReturnValue({ publicKey: new PublicKey(HUNCH_DEVNET_RESOLVER) } as Keypair); };

describe("opt-in Devnet resolution script", () => {
  it("previews market, clocks, and resolver funding without reading a key or submitting", async () => {
    await main([...args, "--keypair", "/not-read/resolver.json"]);
    expect(output()).toMatchObject({ phase: "preview", submitted: false, network: "devnet", programId: HUNCH_PROGRAM_ID, marketId: market.id,
      marketStatus: "closed", requestedOutcome: 1, closesAt: 1000, clusterTime: 1500, resolver: HUNCH_DEVNET_RESOLVER,
      resolverLamports: 1000000, eligible: true, pools: ["30", "70"], warning: expect.stringContaining("irreversible") });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--authorize-devnet-resolution"));
    expectNoKeyOrResolution(); expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["open market", () => { market.status = "open"; }, "MARKET_NOT_CLOSED"],
    ["cluster clock before deadline", () => { clusterTime = 999; }, "MARKET_NOT_CLOSED"],
    ["already resolved", () => { market.status = "resolved"; market.winningOutcome = 0; }, "MARKET_RESOLVED"],
    ["cancelled", () => { market.status = "cancelled"; }, "MARKET_CLOSED"],
    ["unfunded resolver", () => { resolverLamports = 0; }, "INSUFFICIENT_FUNDS"],
  ] as const)("blocks %s before reading a key", async (_label, setup, code) => {
    setup();
    await expect(main(authorized())).rejects.toMatchObject({ code });
    expectNoKeyOrResolution();
  });

  it("previews ineligible markets with the reason", async () => {
    clusterTime = 999;
    await main(args);
    expect(output()).toMatchObject({ eligible: false, prerequisites: expect.stringContaining("cluster clock") });
  });

  it("validates public inputs before any RPC", async () => {
    await expect(main(["--market", market.id])).rejects.toThrow(/Requires/);
    await expect(main(["--market", market.id, "--outcome", "2"])).rejects.toThrow(/Requires/);
    await expect(main(["--market", "bad", "--outcome", "0"])).rejects.toThrow(/valid public/);
    await expect(main([...args, "--authorize-devnet-resolution"])).rejects.toThrow(/--keypair/);
    expect(Connection.prototype.getGenesisHash).not.toHaveBeenCalled(); expectNoKeyOrResolution();
  });

  it("refuses non-Devnet, missing, and unapproved markets without accessing keys", async () => {
    vi.mocked(Connection.prototype.getGenesisHash).mockResolvedValueOnce("mainnet");
    await expect(main(authorized())).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    vi.mocked(Hunch.prototype.getMarket).mockResolvedValueOnce(null);
    await expect(main(authorized())).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
    market.tokenMint = Keypair.generate().publicKey.toBase58();
    await expect(main(authorized())).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    expectNoKeyOrResolution();
  });

  it("refuses resolver keys inside the repository or readable by others", async () => {
    vi.mocked(realpath).mockImplementation(async path => String(path).endsWith("resolver.json") ? `${process.cwd()}/resolver.json` : String(path));
    await expect(main(authorized())).rejects.toThrow(/outside the repository/);
    vi.mocked(realpath).mockImplementation(async path => String(path));
    keyMode = 0o100644;
    if (process.platform !== "win32") await expect(main(authorized())).rejects.toThrow(/chmod 600/);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects a key that is not the market's resolver, and redacts malformed files", async () => {
    await expect(main(authorized())).rejects.toMatchObject({ code: "INVALID_SIGNER" });
    vi.mocked(readFile).mockResolvedValue("private-file-marker");
    await expect(main(authorized())).rejects.toThrow("Unable to read a valid local Solana keypair file");
    expect(JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls])).not.toContain("private-file-marker");
    expect(Hunch.prototype.resolveMarket).not.toHaveBeenCalled();
  });

  it("omits RPC credentials from printed commands", async () => {
    await main([...args, "--rpc", "https://rpc.example/?api-key=credential-marker"]);
    expect(JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls])).not.toContain("credential-marker");
  });

  it("resolves once, after the preview, with explicit authorization and the market's resolver key", async () => {
    useEphemeralResolver();
    vi.mocked(Hunch.prototype.resolveMarket).mockImplementation(async (id, outcome) => {
      expect(output()).toMatchObject({ phase: "preview", submitted: false, eligible: true });
      expect([id, outcome]).toEqual([market.id, 1]);
      market = { ...market, status: "resolved", winningOutcome: 1 };
      return { mode: "anchor", id: "test-only-receipt", signature: "test-only-receipt", status: "confirmed" };
    });
    await main(authorized());
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(Hunch.prototype.resolveMarket).toHaveBeenCalledTimes(1);
    expect(output(1)).toEqual({ result: "PASS", network: "devnet", signature: "test-only-receipt", marketId: market.id,
      marketStatus: "resolved", winningOutcome: 1, confirmed: true, verified: true });
    expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("does not retry when resolution reports an uncertain outcome", async () => {
    useEphemeralResolver();
    vi.mocked(Hunch.prototype.resolveMarket).mockRejectedValue(Object.assign(new Error("uncertain"), { code: "TRANSACTION_UNCERTAIN" }));
    await expect(main(authorized())).rejects.toThrow("uncertain");
    expect(Hunch.prototype.resolveMarket).toHaveBeenCalledTimes(1);
  });
});

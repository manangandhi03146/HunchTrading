import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Connection, Keypair } from "@solana/web3.js";
import {
  Hunch, HUNCH_PROGRAM_ID, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER, deriveMarketPda,
} from "../dist/index.js";
import { main } from "../scripts/devnet-create-market.mjs";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

let publicKey: Keypair["publicKey"];
beforeEach(() => {
  // Ephemeral test material only, in memory; no key file is created or logged.
  const keypair = Keypair.generate();
  publicKey = keypair.publicKey;
  vi.mocked(readFile).mockReset().mockResolvedValue(JSON.stringify(Array.from(keypair.secretKey)));
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Connection.prototype, "getGenesisHash").mockRejectedValue(new Error("Tests must not contact RPC"));
  vi.spyOn(Connection.prototype, "sendRawTransaction").mockRejectedValue(new Error("Tests must not submit transactions"));
  vi.spyOn(Hunch.prototype, "createMarket").mockRejectedValue(new Error("Unexpected creation"));
});
afterEach(() => vi.restoreAllMocks());

const preview = (index = 0) => JSON.parse(vi.mocked(console.log).mock.calls[index][0] as string);

describe("Devnet creation script authorization preview", () => {
  it("previews the intended PDA and approved parameters without authorization, signing or RPC", async () => {
    await main(["--keypair", "/test-only/wallet.json"]);
    const value = preview();
    expect(value).toMatchObject({
      phase: "preview", submitted: false, network: "devnet", programId: HUNCH_PROGRAM_ID,
      creator: publicKey.toBase58(), tokenMint: HUNCH_DEVNET_TOKEN_MINT, resolver: HUNCH_DEVNET_RESOLVER,
      closesAt: 1_800_003_600, question: "Devnet creation verification", outcomes: ["Yes", "No"],
    });
    expect(value.marketSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveMarketPda(publicKey, Uint8Array.from(Buffer.from(value.marketSeed, "hex"))).address.toBase58()).toBe(value.marketId);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`--seed ${value.marketSeed} --closes-at ${value.closesAt}`));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--authorize-devnet-create"));
    expect(Hunch.prototype.createMarket).not.toHaveBeenCalled();
    expect(Connection.prototype.getGenesisHash).not.toHaveBeenCalled();
    expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("generates fresh seeds for new previews", async () => {
    await main(["--keypair", "/test-only/wallet.json"]);
    await main(["--keypair", "/test-only/wallet.json"]);
    expect(preview(0).marketSeed).not.toBe(preview(1).marketSeed);
    expect(preview(0).marketId).not.toBe(preview(1).marketId);
  });

  it("preserves an explicit seed, deadline and shell-quoted question in the authorization command", async () => {
    const seed = "42".repeat(32);
    await main(["--keypair", "/test-only/wallet.json", "--seed", seed, "--closes-at", "1800007200", "--question", "Driver's $(command)?"]);
    expect(preview()).toMatchObject({ marketSeed: seed, closesAt: 1800007200, question: "Driver's $(command)?" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--question 'Driver'\\''s $(command)?'"));
    expect(Hunch.prototype.createMarket).not.toHaveBeenCalled();
  });

  it("omits provider credentials from preview output", async () => {
    await main(["--keypair", "/test-only/wallet.json", "--rpc", "https://rpc.example/?api-key=test-credential"]);
    const output = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(output).not.toContain("test-credential");
    expect(output).toContain("Reuse your --rpc option");
  });

  it("requires an explicit key file even when the authorization flag is supplied", async () => {
    await expect(main(["--authorize-devnet-create"])).rejects.toThrow(/--keypair/);
    expect(readFile).not.toHaveBeenCalled();
    expect(Hunch.prototype.createMarket).not.toHaveBeenCalled();
  });

  it("redacts key file errors and never previews unusable material", async () => {
    vi.mocked(readFile).mockResolvedValue("not valid keypair JSON");
    await expect(main(["--keypair", "/test-only/wallet.json"])).rejects.toThrow("Unable to read a valid local Solana keypair file");
    expect(console.log).not.toHaveBeenCalled();
    expect(Hunch.prototype.createMarket).not.toHaveBeenCalled();
  });

  it("prints the preview before invoking SDK creation only with explicit authorization", async () => {
    vi.mocked(Hunch.prototype.createMarket).mockImplementation(async params => {
      const value = preview();
      expect(value).toMatchObject({ phase: "preview", submitted: false, closesAt: params.closesAt });
      expect(value.marketSeed).toBe(Buffer.from(params.marketSeed!).toString("hex"));
      return {
        market: { id: value.marketId, authority: publicKey.toBase58(), tokenMint: HUNCH_DEVNET_TOKEN_MINT,
          resolverAuthority: HUNCH_DEVNET_RESOLVER, closesAt: params.closesAt, status: "open", pools: [0n, 0n], totalPool: 0n,
          winningOutcome: null, metadata: null },
        transaction: { mode: "anchor", id: "unit-test-receipt", signature: "unit-test-receipt", status: "confirmed" },
        signature: "unit-test-receipt",
      };
    });
    await main(["--keypair", "/test-only/wallet.json", "--authorize-devnet-create"]);
    expect(Hunch.prototype.createMarket).toHaveBeenCalledTimes(1);
    expect(preview(1)).toMatchObject({ result: "PASS", confirmed: true, verified: true });
    expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });
});

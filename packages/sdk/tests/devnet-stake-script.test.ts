import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AccountLayout, AccountState, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { Hunch, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER, HUNCH_PROGRAM_ID, derivePositionPda, deriveVaultPda } from "../dist/index.js";
import type { Market } from "../dist/index.js";
import { main } from "../scripts/devnet-stake.mjs";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("@solana/spl-token", async importOriginal => ({ ...await importOriginal<typeof import("@solana/spl-token")>(), getMint: vi.fn() }));
let user: Keypair, market: Market, args: string[];
const mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT);
function tokenInfo(amount = 10n, owner = user.publicKey) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: SystemProgram.programId, state: AccountState.Initialized, isNativeOption: 0, isNative: 0n,
    delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: SystemProgram.programId }, data);
  return { data, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 1000000, rentEpoch: 0 };
}
beforeEach(() => {
  user = Keypair.generate(); // Ephemeral test signer, never written or printed.
  market = { id: Keypair.generate().publicKey.toBase58(), authority: user.publicKey.toBase58(), resolverAuthority: HUNCH_DEVNET_RESOLVER,
    tokenMint: HUNCH_DEVNET_TOKEN_MINT, closesAt: Math.floor(Date.now() / 1000) + 3600, status: "open", pools: [0n, 0n], totalPool: 0n, winningOutcome: null, metadata: null };
  args = ["--wallet", user.publicKey.toBase58(), "--market", market.id, "--outcome", "0", "--amount", "1"];
  vi.mocked(readFile).mockReset().mockResolvedValue(JSON.stringify(Array.from(user.secretKey)));
  vi.mocked(getMint).mockReset().mockResolvedValue({ address: mint, mintAuthority: Keypair.generate().publicKey, freezeAuthority: null, supply: 1000000n, decimals: 0, isInitialized: true, tlvData: Buffer.alloc(0) });
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  vi.spyOn(Connection.prototype, "getBalance").mockResolvedValue(498511640);
  vi.spyOn(Connection.prototype, "getTokenAccountsByOwner").mockResolvedValue({ context: { slot: 1 }, value: [] });
  vi.spyOn(Connection.prototype, "sendRawTransaction").mockRejectedValue(new Error("Tests must not submit to RPC"));
  vi.spyOn(Hunch.prototype, "getMarket").mockImplementation(async () => market);
  vi.spyOn(Hunch.prototype, "getPositions").mockResolvedValue([]);
  vi.spyOn(Hunch.prototype, "predict").mockRejectedValue(new Error("Unexpected staking"));
});
afterEach(() => vi.restoreAllMocks());
const preview = (index = 0) => JSON.parse(vi.mocked(console.log).mock.calls[index][0] as string);
function funded() {
  vi.mocked(Connection.prototype.getTokenAccountsByOwner).mockResolvedValue({ context: { slot: 1 }, value: [{ pubkey: getAssociatedTokenAddressSync(mint, user.publicKey), account: tokenInfo() }] });
}

describe("opt-in Devnet stake script", () => {
  it("previews public PDAs, parameters and funding needs without reading a key or submitting", async () => {
    await main([...args, "--keypair", "/not-read/wallet.json"]);
    expect(preview()).toMatchObject({ phase: "preview", submitted: false, network: "devnet", programId: HUNCH_PROGRAM_ID,
      wallet: user.publicKey.toBase58(), marketId: market.id, amount: "1", tokenReady: false,
      associatedTokenAccount: getAssociatedTokenAddressSync(mint, user.publicKey).toBase58(),
      positionId: derivePositionPda(new PublicKey(market.id), user.publicKey, 0).address.toBase58(), vault: deriveVaultPda(new PublicKey(market.id)).address.toBase58() });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--authorize-devnet-stake"));
    expect(readFile).not.toHaveBeenCalled(); expect(Hunch.prototype.predict).not.toHaveBeenCalled(); expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("requires explicit key path only when authorized", async () => { await expect(main([...args, "--authorize-devnet-stake"])).rejects.toThrow(/--keypair/); expect(readFile).not.toHaveBeenCalled(); });
  it.each([[], ["--amount", "0"], ["--amount", "18446744073709551616"], ["--outcome", "2"]].map(override => ({ override })))("rejects invalid inputs %# before RPC or key reads", async ({ override }) => {
    const invalid = override.length ? args.map((arg, i) => i > 0 && args[i - 1] === override[0] ? override[1] : arg) : [];
    await expect(main(invalid)).rejects.toThrow(); expect(Connection.prototype.getGenesisHash).not.toHaveBeenCalled(); expect(readFile).not.toHaveBeenCalled();
  });
  it("refuses non-Devnet without accessing keys", async () => { vi.mocked(Connection.prototype.getGenesisHash).mockResolvedValue("mainnet"); await expect(main(args)).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" }); expect(readFile).not.toHaveBeenCalled(); });
  it("does not read keys or stake when authorized but TEST is missing", async () => { await expect(main([...args, "--authorize-devnet-stake", "--keypair", "/test/wallet"])).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" }); expect(readFile).not.toHaveBeenCalled(); expect(Hunch.prototype.predict).not.toHaveBeenCalled(); });
  it("blocks closed markets before reading keys", async () => { funded(); market.status = "closed"; await expect(main([...args, "--authorize-devnet-stake", "--keypair", "/test/wallet"])).rejects.toMatchObject({ code: "MARKET_CLOSED" }); expect(readFile).not.toHaveBeenCalled(); });
  it("rejects a keypair for a different preview wallet", async () => { funded(); vi.mocked(readFile).mockResolvedValue(JSON.stringify(Array.from(Keypair.generate().secretKey))); await expect(main([...args, "--authorize-devnet-stake", "--keypair", "/test/wallet"])).rejects.toMatchObject({ code: "INVALID_SIGNER" }); expect(Hunch.prototype.predict).not.toHaveBeenCalled(); });
  it("redacts malformed private file contents", async () => { funded(); vi.mocked(readFile).mockResolvedValue("private-file-marker"); await expect(main([...args, "--authorize-devnet-stake", "--keypair", "/test/wallet"])).rejects.toThrow("Unable to read a valid local Solana keypair file"); expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("private-file-marker"); });
  it("preserves optional ATA/token-account options and omits RPC credentials in the command", async () => {
    await main([...args, "--create-ata", "--rpc", "https://rpc.example/?api-key=credential-marker"]);
    expect(preview().createAssociatedTokenAccount).toBe(true); expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--create-ata"));
    expect(JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls])).not.toContain("credential-marker");
    expect(readFile).not.toHaveBeenCalled();
  });
  it("calls predict only after a public preview, funded TEST and explicit signing authorization", async () => {
    funded(); vi.mocked(Hunch.prototype.predict).mockImplementation(async params => {
      expect(preview()).toMatchObject({ phase: "preview", submitted: false, tokenReady: true });
      return { position: { marketId: market.id, wallet: user.publicKey.toBase58(), outcome: params.outcome, amount: params.amount, claimed: false, payout: 0n },
        signature: "test-only-receipt", transaction: { mode: "anchor", id: "test-only-receipt", signature: "test-only-receipt", status: "confirmed" } };
    });
    await main([...args, "--authorize-devnet-stake", "--keypair", "/test/wallet"]);
    expect(readFile).toHaveBeenCalledTimes(1); expect(Hunch.prototype.predict).toHaveBeenCalledTimes(1);
    expect(preview(1)).toMatchObject({ result: "PASS", confirmed: true, verified: true, position: { amount: "1" } });
    expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });
});

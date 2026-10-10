import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AccountLayout, AccountState, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Hunch, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER, HUNCH_PROGRAM_ID, derivePositionPda, deriveVaultPda } from "../dist/index.js";
import type { Market, Position } from "../dist/index.js";
import { main } from "../scripts/devnet-claim.mjs";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
let user: Keypair, market: Market, positions: Position[], args: string[], vaultAmount: bigint;
const mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT);
function tokenInfo(amount: bigint, owner: PublicKey, overrides = {}) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: SystemProgram.programId, state: AccountState.Initialized, isNativeOption: 0, isNative: 0n,
    delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: SystemProgram.programId, ...overrides }, data);
  return { data, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 1000000, rentEpoch: 0 };
}
const ataOf = (key: PublicKey) => getAssociatedTokenAddressSync(mint, key);
beforeEach(() => {
  user = Keypair.generate(); // Ephemeral test signer, never written or printed.
  market = { id: Keypair.generate().publicKey.toBase58(), authority: user.publicKey.toBase58(), resolverAuthority: HUNCH_DEVNET_RESOLVER,
    tokenMint: HUNCH_DEVNET_TOKEN_MINT, closesAt: 1000, status: "resolved", pools: [30n, 70n], totalPool: 100n, winningOutcome: 0, metadata: null };
  positions = [{ id: "p", marketId: market.id, wallet: user.publicKey.toBase58(), outcome: 0, amount: 10n, claimed: false, payout: 33n }];
  vaultAmount = 100n;
  args = ["--wallet", user.publicKey.toBase58(), "--market", market.id];
  vi.mocked(readFile).mockReset().mockResolvedValue(JSON.stringify(Array.from(user.secretKey)));
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  vi.spyOn(Connection.prototype, "getBalance").mockResolvedValue(498511640);
  vi.spyOn(Connection.prototype, "getAccountInfo").mockImplementation(async () => tokenInfo(vaultAmount, new PublicKey(market.id)) as never);
  vi.spyOn(Connection.prototype, "getTokenAccountsByOwner").mockResolvedValue({ context: { slot: 1 }, value: [{ pubkey: ataOf(user.publicKey), account: tokenInfo(5n, user.publicKey) }] } as never);
  vi.spyOn(Connection.prototype, "sendRawTransaction").mockRejectedValue(new Error("Tests must not submit to RPC"));
  vi.spyOn(Hunch.prototype, "getMarket").mockImplementation(async () => market);
  vi.spyOn(Hunch.prototype, "getPositions").mockImplementation(async () => positions);
  vi.spyOn(Hunch.prototype, "claimWinnings").mockRejectedValue(new Error("Unexpected claim"));
});
afterEach(() => vi.restoreAllMocks());
const preview = (index = 0) => JSON.parse(vi.mocked(console.log).mock.calls[index][0] as string);
const authorized = () => [...args, "--authorize-devnet-claim", "--keypair", "/test/wallet.json"];
const expectNoKeyOrClaim = () => { expect(readFile).not.toHaveBeenCalled(); expect(Hunch.prototype.claimWinnings).not.toHaveBeenCalled(); };

describe("opt-in Devnet claim script", () => {
  it("previews the exact payout, PDAs and recipient without reading a key or submitting", async () => {
    await main([...args, "--keypair", "/not-read/wallet.json"]);
    const marketKey = new PublicKey(market.id);
    expect(preview()).toMatchObject({ phase: "preview", submitted: false, network: "devnet", programId: HUNCH_PROGRAM_ID,
      wallet: user.publicKey.toBase58(), marketId: market.id, marketStatus: "resolved", winningOutcome: 0, expectedPayout: "33",
      winningPositionId: derivePositionPda(marketKey, user.publicKey, 0).address.toBase58(), vault: deriveVaultPda(marketKey).address.toBase58(),
      vaultBalance: "100", recipientTokenAccount: ataOf(user.publicKey).toBase58(), claimable: true, recipientReady: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--authorize-devnet-claim"));
    expectNoKeyOrClaim(); expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });
  it.each([
    ["unresolved", () => { market.status = "closed"; market.winningOutcome = null; }, "MARKET_NOT_RESOLVED"],
    ["losing", () => { positions = [{ ...positions[0], outcome: 1, payout: 0n }]; }, "NO_WINNING_POSITION"],
    ["no position", () => { positions = []; }, "NO_WINNING_POSITION"],
    ["already claimed", () => { positions = [{ ...positions[0], claimed: true }]; }, "ALREADY_CLAIMED"],
    ["underfunded vault", () => { vaultAmount = 32n; }, "INVALID_INPUT"],
  ] as const)("blocks %s claims before reading a key", async (_name, setup, code) => {
    setup();
    await expect(main(authorized())).rejects.toMatchObject({ code }); expectNoKeyOrClaim();
  });
  it("requires a recipient choice when the wallet has no usable token account", async () => {
    vi.mocked(Connection.prototype.getTokenAccountsByOwner).mockResolvedValue({ context: { slot: 1 }, value: [] } as never);
    await expect(main(authorized())).rejects.toMatchObject({ code: "INVALID_INPUT" }); expectNoKeyOrClaim();
    await main([...args, "--create-ata"]);
    expect(preview(1)).toMatchObject({ recipientReady: true, recipientTokenAccount: ataOf(user.publicKey).toBase58(), createAssociatedTokenAccount: true });
  });
  it("requires an explicit key path only when authorized, and rejects invalid public inputs before RPC", async () => {
    await expect(main([...args, "--authorize-devnet-claim"])).rejects.toThrow(/--keypair/);
    await expect(main(["--wallet", "bad", "--market", market.id])).rejects.toThrow(/valid public/);
    await expect(main([...args, "--token-account", market.id, "--create-ata"])).rejects.toThrow(/not both/);
    await expect(main([])).rejects.toThrow(/Requires/);
    expect(Connection.prototype.getGenesisHash).not.toHaveBeenCalled(); expectNoKeyOrClaim();
  });
  it("refuses non-Devnet and unapproved markets without accessing keys", async () => {
    vi.mocked(Connection.prototype.getGenesisHash).mockResolvedValueOnce("mainnet");
    await expect(main(authorized())).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    market.resolverAuthority = user.publicKey.toBase58();
    await expect(main(authorized())).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" }); expectNoKeyOrClaim();
  });
  it("rejects a keypair for a different preview wallet", async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(Array.from(Keypair.generate().secretKey)));
    await expect(main(authorized())).rejects.toMatchObject({ code: "INVALID_SIGNER" }); expect(Hunch.prototype.claimWinnings).not.toHaveBeenCalled();
  });
  it("redacts malformed private file contents", async () => {
    vi.mocked(readFile).mockResolvedValue("private-file-marker");
    await expect(main(authorized())).rejects.toThrow("Unable to read a valid local Solana keypair file");
    expect(JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls])).not.toContain("private-file-marker");
  });
  it("omits RPC credentials and preserves recipient options in the authorization command", async () => {
    const other = Keypair.generate().publicKey;
    vi.mocked(Connection.prototype.getTokenAccountsByOwner).mockResolvedValue({ context: { slot: 1 }, value: [{ pubkey: other, account: tokenInfo(0n, user.publicKey) }] } as never);
    await main([...args, "--token-account", other.toBase58(), "--rpc", "https://rpc.example/?api-key=credential-marker"]);
    expect(preview()).toMatchObject({ recipientTokenAccount: other.toBase58(), recipientReady: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`--token-account ${other.toBase58()}`));
    expect(JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls])).not.toContain("credential-marker");
  });
  it("calls claimWinnings once, after the preview, only with explicit authorization and a matching key", async () => {
    vi.mocked(Hunch.prototype.claimWinnings).mockImplementation(async (_id, options) => {
      expect(preview()).toMatchObject({ phase: "preview", submitted: false, claimable: true });
      expect(options).toEqual({ createAssociatedTokenAccount: false });
      return { payout: 33n, signature: "test-only-receipt", transaction: { mode: "anchor", id: "test-only-receipt", signature: "test-only-receipt", status: "confirmed" },
        position: { ...positions[0], claimed: true } };
    });
    await main(authorized());
    expect(readFile).toHaveBeenCalledTimes(1); expect(Hunch.prototype.claimWinnings).toHaveBeenCalledTimes(1);
    expect(preview(1)).toMatchObject({ result: "PASS", payout: "33", confirmed: true, verified: true, position: { claimed: true } });
    expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });
});

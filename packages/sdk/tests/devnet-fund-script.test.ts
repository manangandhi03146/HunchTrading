import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { utils } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { AccountLayout, AccountState, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT } from "../dist/index.js";
import { main } from "../scripts/devnet-fund-wallet.mjs";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
const mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT);
let source: Keypair, recipient: PublicKey, tokens: Map<string, ReturnType<typeof tokenInfo>>, sent: Transaction[], lamports: Map<string, number>;
function tokenInfo(owner: PublicKey, amount: bigint, overrides = {}) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: SystemProgram.programId, state: AccountState.Initialized, isNativeOption: 0, isNative: 0n,
    delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: SystemProgram.programId, ...overrides }, data);
  return { data, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 2039280, rentEpoch: 0 };
}
const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner);
beforeEach(() => {
  source = Keypair.generate(); recipient = Keypair.generate().publicKey; sent = []; // Ephemeral, never written or printed.
  tokens = new Map([[ata(source.publicKey).toBase58(), tokenInfo(source.publicKey, 90n)]]);
  lamports = new Map([[source.publicKey.toBase58(), 494457960], [recipient.toBase58(), 0]]);
  vi.mocked(readFile).mockReset().mockResolvedValue(JSON.stringify(Array.from(source.secretKey)));
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  vi.spyOn(Connection.prototype, "getMultipleAccountsInfo").mockImplementation(async keys => keys.map(key => tokens.get(key.toBase58()) ?? null) as never);
  vi.spyOn(Connection.prototype, "getAccountInfo").mockImplementation(async key => (tokens.get(key.toBase58()) ?? null) as never);
  vi.spyOn(Connection.prototype, "getBalance").mockImplementation(async key => lamports.get(key.toBase58()) ?? 0);
  vi.spyOn(Connection.prototype, "getMinimumBalanceForRentExemption").mockResolvedValue(2039280);
  vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 500 });
  // Simulates the cluster applying the transfer.
  vi.spyOn(Connection.prototype, "sendRawTransaction").mockImplementation(async bytes => {
    const tx = Transaction.from(bytes); sent.push(tx);
    const transfer = tx.instructions.find(ix => ix.programId.equals(SystemProgram.programId));
    if (transfer) lamports.set(recipient.toBase58(), (lamports.get(recipient.toBase58()) ?? 0) + Number(transfer.data.readBigUInt64LE(4)));
    const tokenIx = tx.instructions.find(ix => ix.programId.equals(TOKEN_PROGRAM_ID));
    if (tokenIx) {
      const moved = tokenIx.data.readBigUInt64LE(1), dest = ata(recipient).toBase58();
      tokens.set(dest, tokenInfo(recipient, (tokens.has(dest) ? AccountLayout.decode(tokens.get(dest)!.data).amount : 0n) + moved));
    }
    return utils.bytes.bs58.encode(tx.signature!);
  });
  vi.spyOn(Connection.prototype, "confirmTransaction").mockResolvedValue({ context: { slot: 3 }, value: { err: null } });
});
afterEach(() => vi.restoreAllMocks());
const output = (index = 0) => JSON.parse(vi.mocked(console.log).mock.calls[index][0] as string);
const args = () => ["--from", source.publicKey.toBase58(), "--to", recipient.toBase58(), "--amount", "40", "--lamports", "20000000"];
const authorized = () => [...args(), "--authorize-devnet-transfer", "--keypair", "/test/source.json"];

describe("opt-in Devnet funding script", () => {
  it("previews balances, recipient ATA creation, and required SOL without reading a key", async () => {
    await main([...args(), "--keypair", "/not-read.json"]);
    expect(output()).toMatchObject({ phase: "preview", submitted: false, amount: "40", lamports: "20000000", sourceTest: "90", destinationTest: "0",
      destinationTokenAccount: ata(recipient).toBase58(), createDestinationTokenAccount: true, requiredLamports: "22049280", ready: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--authorize-devnet-transfer"));
    expect(readFile).not.toHaveBeenCalled(); expect(sent).toHaveLength(0);
  });

  it("validates inputs before any RPC", async () => {
    const from = source.publicKey.toBase58(), to = recipient.toBase58();
    await expect(main(["--from", from])).rejects.toThrow(/Requires/);
    await expect(main(["--from", from, "--to", to])).rejects.toThrow(/Nothing to transfer/);
    await expect(main(["--from", from, "--to", from, "--amount", "1"])).rejects.toThrow(/must differ/);
    await expect(main(["--from", from, "--to", to, "--lamports", "1000000001"])).rejects.toThrow(/limited/);
    await expect(main(["--from", from, "--to", to, "--amount", "18446744073709551616"])).rejects.toThrow(/u64/);
    await expect(main(["--from", "bad", "--to", to, "--amount", "1"])).rejects.toThrow(/valid public/);
    await expect(main([...args(), "--authorize-devnet-transfer"])).rejects.toThrow(/--keypair/);
    expect(Connection.prototype.getGenesisHash).not.toHaveBeenCalled();
  });

  it("refuses non-Devnet and insufficient TEST or SOL before reading a key", async () => {
    vi.mocked(Connection.prototype.getGenesisHash).mockResolvedValueOnce("mainnet");
    await expect(main(authorized())).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    await expect(main([...authorized().slice(0, 4), "--amount", "91", ...authorized().slice(6)])).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    lamports.set(source.publicKey.toBase58(), 1000);
    await expect(main(authorized())).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(readFile).not.toHaveBeenCalled(); expect(sent).toHaveLength(0);
  });

  it("rejects a key for a different source and redacts malformed files", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(Array.from(Keypair.generate().secretKey)));
    await expect(main(authorized())).rejects.toMatchObject({ code: "INVALID_SIGNER" });
    vi.mocked(readFile).mockResolvedValueOnce("private-file-marker");
    await expect(main(authorized())).rejects.toThrow("Unable to read a valid local Solana keypair file");
    expect(JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls])).not.toContain("private-file-marker");
    expect(sent).toHaveLength(0);
  });

  it("sends SOL, creates the recipient ATA idempotently, and transfers TEST in one signed transaction", async () => {
    await main(authorized());
    expect(sent).toHaveLength(1);
    const [sol, create, transfer] = sent[0].instructions;
    expect(sol.programId.equals(SystemProgram.programId)).toBe(true);
    expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(Array.from(create.data)).toEqual([1]);
    expect(transfer.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(transfer.data[0]).toBe(12); // TransferChecked with the mint's zero decimals.
    expect(transfer.data.readBigUInt64LE(1)).toBe(40n);
    expect(transfer.data[9]).toBe(0);
    expect(sent[0].feePayer!.equals(source.publicKey)).toBe(true);
    expect(sent[0].verifySignatures()).toBe(true);
    expect(output(1)).toMatchObject({ result: "PASS", signature: utils.bytes.bs58.encode(sent[0].signature!), toLamports: 20000000, destinationTest: "40", verified: true });
  });

  it("can fund SOL only, for example the resolver's fee balance", async () => {
    await main(["--from", source.publicKey.toBase58(), "--to", recipient.toBase58(), "--lamports", "10000000", "--authorize-devnet-transfer", "--keypair", "/test/source.json"]);
    expect(sent[0].instructions).toHaveLength(1);
    expect(output(1)).toMatchObject({ result: "PASS", toLamports: 10000000, verified: true });
  });

  it("reports uncertain submission with the signature and never retries", async () => {
    vi.mocked(Connection.prototype.sendRawTransaction).mockRejectedValueOnce(new Error("socket hang up"));
    await expect(main(authorized())).rejects.toMatchObject({ code: "TRANSACTION_UNCERTAIN", details: { signature: expect.any(String), lastValidBlockHeight: 500 } });
    expect(Connection.prototype.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("reports on-chain failure and unverified balances explicitly", async () => {
    vi.mocked(Connection.prototype.confirmTransaction).mockResolvedValueOnce({ context: { slot: 3 }, value: { err: { InstructionError: [2, { Custom: 1 }] } } });
    await expect(main(authorized())).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
    vi.mocked(Connection.prototype.sendRawTransaction).mockImplementationOnce(async bytes => utils.bytes.bs58.encode(Transaction.from(bytes).signature!));
    await expect(main(authorized())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

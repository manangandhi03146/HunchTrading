import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BN, BorshCoder, utils } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SendTransactionError, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction } from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import idl from "../src/idl/marketkit.json";
import {
  AnchorMarketAdapter, Hunch, MockMarketAdapter, createMockWallet, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_PROGRAM_ID, deriveMarketPda,
} from "../src/index.js";
import type { Outcome, WalletSigner } from "../src/index.js";

const coder = new BorshCoder(idl as Idl), program = new PublicKey(HUNCH_PROGRAM_ID), mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT);
const seed = new Uint8Array(32).fill(5), blockhash = Keypair.generate().publicKey.toBase58();
const SYSVAR_OWNER = new PublicKey("Sysvar1111111111111111111111111111111111111");
const info = (data: Buffer, owner = program): AccountInfo<Buffer> => ({ data, owner, executable: false, lamports: 10000000, rentEpoch: 0 });

let creator: PublicKey, resolver: Keypair, signer: WalletSigner, connection: Connection, adapter: AnchorMarketAdapter;
let market: PublicKey, accounts: Map<string, AccountInfo<Buffer>>, sent: Transaction | undefined, recordOutcome: boolean | Outcome;

function clockInfo(unixTimestamp: number, owner = SYSVAR_OWNER) {
  const data = Buffer.alloc(40);
  data.writeBigUInt64LE(10n, 0); data.writeBigInt64LE(BigInt(unixTimestamp), 32);
  return info(data, owner);
}
async function marketInfo(overrides: Record<string, unknown> = {}) {
  const data = Buffer.alloc(coder.accounts.size("Market"));
  (await coder.accounts.encode("Market", { authority: creator, resolver: resolver.publicKey, token_mint: mint, market_id: Array.from(seed),
    deadline: new BN(1100), pool: [new BN(30), new BN(70)], winning_outcome: null, status: { Active: {} },
    bump: deriveMarketPda(creator, seed).bump, ...overrides })).copy(data);
  return info(data);
}
const setMarket = async (overrides: Record<string, unknown> = {}) => accounts.set(market.toBase58(), await marketInfo(overrides));

beforeEach(async () => {
  // Ephemeral keys, never persisted or printed.
  creator = Keypair.generate().publicKey; resolver = Keypair.generate();
  market = deriveMarketPda(creator, seed).address;
  sent = undefined; recordOutcome = true;
  accounts = new Map([[program.toBase58(), { ...info(Buffer.alloc(0), SystemProgram.programId), executable: true }],
    [SYSVAR_CLOCK_PUBKEY.toBase58(), clockInfo(1500)]]);
  await setMarket();
  connection = new Connection("http://127.0.0.1:8899");
  vi.spyOn(connection, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  vi.spyOn(connection, "getAccountInfo").mockImplementation(async key => accounts.get(key.toBase58()) ?? null);
  vi.spyOn(connection, "getMultipleAccountsInfo").mockImplementation(async keys => keys.map(key => accounts.get(key.toBase58()) ?? null));
  vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({ blockhash, lastValidBlockHeight: 2000 });
  vi.spyOn(connection, "getFeeForMessage").mockResolvedValue({ context: { slot: 1 }, value: 5000 });
  vi.spyOn(connection, "getBalance").mockResolvedValue(1000000);
  // Simulates resolve_market: records the instruction's winning outcome on the Market account.
  vi.spyOn(connection, "sendRawTransaction").mockImplementation(async bytes => {
    sent = Transaction.from(bytes);
    const decoded = coder.instruction.decode(sent.instructions.at(-1)!.data) as { data: { winning_outcome: number } };
    if (recordOutcome !== false) {
      const outcome = recordOutcome === true ? decoded.data.winning_outcome : recordOutcome;
      await setMarket({ winning_outcome: outcome, status: { Resolved: {} } });
    }
    return utils.bytes.bs58.encode(sent.signature!);
  });
  vi.spyOn(connection, "confirmTransaction").mockResolvedValue({ context: { slot: 7 }, value: { err: null } });
  signer = { publicKey: resolver.publicKey, signTransaction: vi.fn(async tx => { if (tx instanceof Transaction) tx.partialSign(resolver); else tx.sign([resolver]); return tx; }) };
  adapter = new AnchorMarketAdapter({ connection, clock: () => 2000, resolverAuthority: resolver.publicKey.toBase58() });
});
afterEach(() => { delete (globalThis as { document?: unknown }).document; });

const resolve = (outcome: Outcome = 1, wallet = signer) => adapter.resolveMarket(market.toBase58(), outcome, wallet);
const expectNoSign = () => { expect(signer.signTransaction).not.toHaveBeenCalled(); expect(connection.sendRawTransaction).not.toHaveBeenCalled(); };
const simulationError = (logs: string[]) => new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "Transaction simulation failed", logs });

describe("authorized Anchor resolution", () => {
  it.each([0, 1] as const)("signs the exact IDL resolve_market for outcome %s, confirms, and verifies the resolved market", async (outcome) => {
    const result = await resolve(outcome);
    expect(sent!.instructions).toHaveLength(1);
    const ix = sent!.instructions[0];
    expect(ix.programId.equals(program)).toBe(true);
    // The IDL resolver is a read-only signer; as fee payer it is writable in the compiled message.
    expect(ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [resolver.publicKey.toBase58(), true, true], [market.toBase58(), false, true],
    ]);
    const decoded = coder.instruction.decode(ix.data)!;
    expect(decoded.name).toBe("resolve_market");
    expect(decoded.data).toEqual({ winning_outcome: outcome });
    expect(sent!.feePayer!.equals(resolver.publicKey)).toBe(true);
    expect(sent!.verifySignatures()).toBe(true);
    const signature = utils.bytes.bs58.encode(sent!.signature!);
    expect(result).toEqual({ mode: "anchor", id: signature, signature, status: "confirmed" });
    expect(connection.sendRawTransaction).toHaveBeenCalledWith(expect.anything(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
    expect(connection.confirmTransaction).toHaveBeenCalledWith({ signature, blockhash, lastValidBlockHeight: 2000 }, "confirmed");
    // Read-back is pinned at or after the confirmation slot.
    expect(connection.getMultipleAccountsInfo).toHaveBeenLastCalledWith([market], { commitment: "confirmed", minContextSlot: 7 });
    expect((await adapter.getMarket(market.toBase58()))).toMatchObject({ status: "resolved", winningOutcome: outcome });
  });

  it("is reachable through the Hunch client only with the resolver signer", async () => {
    const sdk = new Hunch({ mode: "anchor", connection, wallet: signer, clock: () => 2000, resolverAuthority: resolver.publicKey.toBase58() });
    expect((await sdk.resolveMarket(market.toBase58(), 0)).status).toBe("confirmed");
    const player = Keypair.generate();
    const userSdk = new Hunch({ mode: "anchor", connection, clock: () => 2000, resolverAuthority: resolver.publicKey.toBase58(),
      wallet: { publicKey: player.publicKey, signTransaction: vi.fn() } });
    await expect(userSdk.resolveMarket(market.toBase58(), 0)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a prediction wallet before any RPC or signature request", async () => {
    const player = Keypair.generate();
    const wallet = { publicKey: player.publicKey, signTransaction: vi.fn() };
    await expect(resolve(1, wallet)).rejects.toMatchObject({ code: "UNAUTHORIZED", details: { expectedResolver: resolver.publicKey.toBase58() } });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(connection.getGenesisHash).not.toHaveBeenCalled();
  });

  it("defaults to the approved Devnet resolver and rejects other signers", async () => {
    const defaults = new AnchorMarketAdapter({ connection, clock: () => 2000 });
    await expect(defaults.resolveMarket(market.toBase58(), 0, signer)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expectNoSign();
  });

  it("rejects a market whose stored resolver differs from the configured signer", async () => {
    await setMarket({ resolver: Keypair.generate().publicKey });
    await expect(resolve()).rejects.toMatchObject({ code: "UNAUTHORIZED", message: expect.stringContaining("different resolver") });
    expectNoSign();
  });

  it.each([2, -1, "1", 0.5, null])("rejects invalid outcome %j before RPC", async (outcome) => {
    await expect(resolve(outcome as Outcome)).rejects.toMatchObject({ code: "INVALID_OUTCOME" });
    expect(connection.getGenesisHash).not.toHaveBeenCalled();
    expectNoSign();
  });

  it("rejects resolution before the deadline by the local clock", async () => {
    adapter = new AnchorMarketAdapter({ connection, clock: () => 1099, resolverAuthority: resolver.publicKey.toBase58() });
    await expect(resolve()).rejects.toMatchObject({ code: "MARKET_NOT_CLOSED", details: { closesAt: 1100 } });
    expectNoSign();
  });

  it("rejects resolution while the cluster clock is still before the deadline", async () => {
    accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), clockInfo(1099));
    await expect(resolve()).rejects.toMatchObject({ code: "MARKET_NOT_CLOSED", details: { clusterTime: 1099, closesAt: 1100 } });
    expectNoSign();
  });

  it("accepts the exact deadline second on both clocks", async () => {
    adapter = new AnchorMarketAdapter({ connection, clock: () => 1100, resolverAuthority: resolver.publicKey.toBase58() });
    accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), clockInfo(1100));
    expect((await resolve()).status).toBe("confirmed");
  });

  it.each([
    ["missing", null], ["owned by another program", clockInfo(1500, program)], ["truncated", info(Buffer.alloc(39), SYSVAR_OWNER)],
  ] as const)("rejects a %s Clock sysvar", async (_label, clock) => {
    if (clock) accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), clock); else accounts.delete(SYSVAR_CLOCK_PUBKEY.toBase58());
    await expect(resolve()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expectNoSign();
  });

  it("rejects an already resolved market without submitting", async () => {
    await setMarket({ winning_outcome: 0, status: { Resolved: {} } });
    await expect(resolve(0)).rejects.toMatchObject({ code: "MARKET_RESOLVED", details: { winningOutcome: 0 } });
    expectNoSign();
  });

  it("rejects a cancelled market", async () => {
    await setMarket({ status: { Cancelled: {} } });
    await expect(resolve()).rejects.toMatchObject({ code: "MARKET_CLOSED" });
    expectNoSign();
  });

  it("rejects a missing market and an invalid market ID", async () => {
    accounts.delete(market.toBase58());
    await expect(resolve()).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
    await expect(adapter.resolveMarket("not-a-key", 1, signer)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expectNoSign();
  });

  it("refuses markets escrowing a different mint", async () => {
    await setMarket({ token_mint: Keypair.generate().publicKey });
    await expect(resolve()).rejects.toMatchObject({ code: "CONFIGURATION_ERROR", message: expect.stringContaining("mint") });
    expectNoSign();
  });

  it("is restricted to Devnet and a deployed program", async () => {
    vi.mocked(connection.getGenesisHash).mockResolvedValueOnce("mainnet-genesis");
    await expect(resolve()).rejects.toMatchObject({ code: "CONFIGURATION_ERROR", message: expect.stringContaining("Devnet") });
    accounts.delete(program.toBase58());
    await expect(resolve()).rejects.toMatchObject({ code: "CONFIGURATION_ERROR", message: expect.stringContaining("not deployed") });
    expectNoSign();
  });

  it("rejects corrupt market data", async () => {
    accounts.set(market.toBase58(), info(Buffer.alloc(164)));
    await expect(resolve()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expectNoSign();
  });

  it("checks resolver SOL for the fee", async () => {
    vi.mocked(connection.getBalance).mockResolvedValue(4999);
    await expect(resolve()).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS", details: { requiredLamports: 5000, balanceLamports: 4999 } });
    vi.mocked(connection.getFeeForMessage).mockResolvedValue({ context: { slot: 1 }, value: null });
    await expect(resolve()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expectNoSign();
  });

  it("reports RPC failures during preflight as network errors", async () => {
    vi.mocked(connection.getMultipleAccountsInfo).mockRejectedValueOnce(new Error("fetch failed"));
    await expect(resolve()).rejects.toMatchObject({ code: "NETWORK_ERROR", details: { marketId: market.toBase58() } });
    vi.mocked(connection.getLatestBlockhash).mockRejectedValueOnce(new Error("fetch failed"));
    await expect(resolve()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expectNoSign();
  });

  it.each([
    null, {}, { publicKey: "base58", signTransaction: vi.fn() }, { publicKey: Keypair.generate().publicKey },
    { publicKey: PublicKey.findProgramAddressSync([Buffer.from("off-curve")], program)[0], signTransaction: vi.fn() },
  ])("rejects invalid signer %#", async (bad) => {
    await expect(resolve(1, bad as unknown as WalletSigner)).rejects.toMatchObject({ code: "INVALID_SIGNER" });
    expect(connection.getGenesisHash).not.toHaveBeenCalled();
  });

  it("is disabled in browsers even with the resolver key", async () => {
    (globalThis as { document?: unknown }).document = {};
    await expect(resolve()).rejects.toMatchObject({ code: "UNAUTHORIZED", message: expect.stringContaining("browsers") });
    expectNoSign();
  });

  it("maps a rejecting, unsigned, or altering signer without submitting", async () => {
    vi.mocked(signer.signTransaction).mockRejectedValueOnce(Object.assign(new Error("User rejected"), { code: 4001 }));
    await expect(resolve()).rejects.toMatchObject({ code: "USER_REJECTED" });
    vi.mocked(signer.signTransaction).mockImplementationOnce(async tx => tx);
    await expect(resolve()).rejects.toMatchObject({ code: "INVALID_SIGNER" });
    vi.mocked(signer.signTransaction).mockImplementationOnce(async tx => {
      const altered = new Transaction({ feePayer: resolver.publicKey, blockhash, lastValidBlockHeight: 2000 }).add(SystemProgram.transfer({ fromPubkey: resolver.publicKey, toPubkey: creator, lamports: 1 }));
      altered.sign(resolver); return altered as typeof tx;
    });
    await expect(resolve()).rejects.toMatchObject({ code: "INVALID_SIGNER" });
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["0x1772", "MARKET_RESOLVED"], ["0x1776", "UNAUTHORIZED"], ["0x7d1", "UNAUTHORIZED"], ["0x1774", "MARKET_NOT_CLOSED"],
    ["0x1771", "INVALID_OUTCOME"], ["0x1775", "TRANSACTION_FAILED"],
  ])("maps preflight program error %s to %s", async (hex, code) => {
    vi.mocked(connection.sendRawTransaction).mockRejectedValueOnce(simulationError([`Program ${HUNCH_PROGRAM_ID} failed: custom program error: ${hex}`]));
    await expect(resolve()).rejects.toMatchObject({ code, details: { stage: "preflight", signature: expect.any(String) } });
    expect(connection.confirmTransaction).not.toHaveBeenCalled();
  });

  it("maps a confirmed on-chain failure from the resolution instruction", async () => {
    vi.mocked(connection.confirmTransaction).mockResolvedValueOnce({ context: { slot: 7 }, value: { err: { InstructionError: [0, { Custom: 6002 }] } } });
    await expect(resolve()).rejects.toMatchObject({ code: "MARKET_RESOLVED", details: { error: { InstructionError: [0, { Custom: 6002 }] } } });
  });

  it("hands the signature and expiry height to onSigned before broadcasting", async () => {
    const order: string[] = [];
    vi.mocked(connection.sendRawTransaction).mockImplementationOnce(async bytes => { order.push("send"); return utils.bytes.bs58.encode(Transaction.from(bytes).signature!); });
    recordOutcome = false;
    const onSigned = vi.fn(async (submission: { signature: string }) => { order.push(`signed:${submission.signature.length > 0}`); });
    await adapter.resolveMarket(market.toBase58(), 1, signer, { onSigned }).catch(() => undefined);
    expect(order).toEqual(["signed:true", "send"]);
    expect(onSigned).toHaveBeenCalledWith({ signature: expect.any(String), blockhash, lastValidBlockHeight: 2000 });
  });

  it("submits nothing when onSigned cannot persist the signature", async () => {
    const onSigned = vi.fn(async () => { throw new Error("SQLITE_BUSY"); });
    await expect(adapter.resolveMarket(market.toBase58(), 1, signer, { onSigned }))
      .rejects.toMatchObject({ code: "TRANSACTION_FAILED", details: { stage: "pre-submission", signature: expect.any(String) } });
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
    await expect(adapter.resolveMarket(market.toBase58(), 1, signer, { onSigned: "nope" as never })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("reports an uncertain submission with the signature and expiry height, and never resubmits", async () => {
    vi.mocked(connection.sendRawTransaction).mockRejectedValueOnce(new Error("socket hang up"));
    const error = await resolve().catch(e => e);
    expect(error).toMatchObject({ code: "TRANSACTION_UNCERTAIN", details: { stage: "submission", blockhash, lastValidBlockHeight: 2000, marketId: market.toBase58() } });
    expect(utils.bytes.bs58.decode(error.details.signature)).toHaveLength(64);
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(signer.signTransaction).toHaveBeenCalledTimes(1);
  });

  it("reports an uncertain confirmation without resubmitting", async () => {
    vi.mocked(connection.confirmTransaction).mockRejectedValueOnce(new Error("block height exceeded check timed out"));
    await expect(resolve()).rejects.toMatchObject({ code: "TRANSACTION_UNCERTAIN", details: { stage: "confirmation", signature: expect.any(String), lastValidBlockHeight: 2000 } });
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["market unchanged", false], ["different outcome recorded", 0],
  ] as const)("fails verification when the confirmed market shows %s", async (_label, recorded) => {
    recordOutcome = recorded;
    await expect(resolve(1)).rejects.toMatchObject({ code: "INVALID_RESPONSE", details: { stage: "verification", confirmationStatus: "confirmed", signature: expect.any(String) } });
  });

  it("fails verification when the market disappears or the read-back RPC fails", async () => {
    vi.mocked(connection.confirmTransaction).mockImplementationOnce(async () => { accounts.delete(market.toBase58()); return { context: { slot: 7 }, value: { err: null } }; });
    await expect(resolve()).rejects.toMatchObject({ code: "INVALID_RESPONSE", details: { stage: "verification" } });
    await setMarket();
    vi.mocked(connection.getMultipleAccountsInfo)
      .mockImplementationOnce(async keys => keys.map(key => accounts.get(key.toBase58()) ?? null))
      .mockRejectedValueOnce(new Error("fetch failed"));
    await expect(resolve()).rejects.toMatchObject({ code: "INVALID_RESPONSE", details: { stage: "verification" } });
  });
});

describe("Anchor transaction status for reconciliation", () => {
  const signature = utils.bytes.bs58.encode(new Uint8Array(64).fill(3));
  const status = (value: unknown) => vi.spyOn(connection, "getSignatureStatuses").mockResolvedValue({ context: { slot: 1 }, value: [value as never] });
  it.each([
    [null, "not_found"], [{ slot: 1, confirmations: 0, err: null, confirmationStatus: "processed" }, "submitted"],
    [{ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }, "confirmed"],
    [{ slot: 1, confirmations: null, err: null, confirmationStatus: "finalized" }, "confirmed"],
  ])("maps %j to %s with history search", async (value, expected) => {
    status(value);
    expect(await adapter.getTransactionStatus(signature)).toEqual({ mode: "anchor", id: signature, signature, status: expected });
    expect(connection.getSignatureStatuses).toHaveBeenCalledWith([signature], { searchTransactionHistory: true });
  });
  it("reports on-chain failures", async () => {
    status({ slot: 1, confirmations: null, err: { InstructionError: [0, { Custom: 6002 }] }, confirmationStatus: "finalized" });
    expect(await adapter.getTransactionStatus(signature)).toMatchObject({ status: "failed", error: expect.stringContaining("6002") });
  });
  it("validates signatures and reports RPC failures", async () => {
    await expect(adapter.getTransactionStatus("mock:1")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(adapter.getTransactionStatus(utils.bytes.bs58.encode(new Uint8Array(32)))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    vi.spyOn(connection, "getSignatureStatuses").mockRejectedValue(new Error("fetch failed"));
    await expect(adapter.getTransactionStatus(signature)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("mock resolution compatibility", () => {
  it("keeps mock authorization, deadline, and repeat-resolution rules", async () => {
    let time = 1000;
    const mockResolver = createMockWallet(new PublicKey(new Uint8Array(32).fill(2))), owner = createMockWallet(new PublicKey(new Uint8Array(32).fill(1)));
    const mock = new MockMarketAdapter({ resolverAuthority: mockResolver.publicKey.toBase58(), authorizedCreators: [owner.publicKey.toBase58()], clock: () => time });
    await mock.createMarket({ id: "m", question: "Q", outcomes: ["A", "B"], closesAt: 1100 }, owner);
    await expect(mock.resolveMarket("m", 0, mockResolver)).rejects.toMatchObject({ code: "MARKET_NOT_CLOSED" });
    time = 1100;
    await expect(mock.resolveMarket("m", 0, owner)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await mock.resolveMarket("m", 0, mockResolver)).toMatchObject({ mode: "mock", signature: null, status: "confirmed" });
    await expect(mock.resolveMarket("m", 1, mockResolver)).rejects.toMatchObject({ code: "MARKET_RESOLVED" });
  });
});

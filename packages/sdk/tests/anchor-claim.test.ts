import { beforeEach, describe, expect, it, vi } from "vitest";
import { BN, BorshCoder, utils } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SendTransactionError, SystemProgram, Transaction } from "@solana/web3.js";
import type { AccountInfo, TokenBalance } from "@solana/web3.js";
import { AccountLayout, AccountState, ASSOCIATED_TOKEN_PROGRAM_ID, MintLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idl from "../src/idl/marketkit.json";
import {
  AnchorMarketAdapter, Hunch, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER, HUNCH_PROGRAM_ID,
  U64_MAX, computeClaimPayout, deriveMarketPda, derivePositionPda, deriveVaultPda,
} from "../src/index.js";
import type { ClaimOptions, WalletSigner } from "../src/index.js";

const coder = new BorshCoder(idl as Idl), program = new PublicKey(HUNCH_PROGRAM_ID);
const mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT), resolver = new PublicKey(HUNCH_DEVNET_RESOLVER);
const seed = new Uint8Array(32).fill(7), blockhash = Keypair.generate().publicKey.toBase58();
const info = (data: Buffer, owner = program): AccountInfo<Buffer> => ({ data, owner, executable: false, lamports: 10000000, rentEpoch: 0 });

let creator: PublicKey, user: Keypair, wallet: WalletSigner, connection: Connection, adapter: AnchorMarketAdapter;
let market: PublicKey, position: PublicKey, vault: PublicKey, ata: PublicKey;
let accounts: Map<string, AccountInfo<Buffer>>, owned: { pubkey: PublicKey; account: AccountInfo<Buffer> }[];
let sent: Transaction | undefined, response: unknown;
let pools: [bigint, bigint], stake: bigint, winning: 0 | 1;
// Hooks for simulating chain behavior after submission.
let movedToRecipient: (payout: bigint) => bigint, markClaimed: boolean, afterSend: (map: Map<string, AccountInfo<Buffer>>) => Promise<void>;

function mintInfo(overrides = {}) {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: SystemProgram.programId, supply: 1000000n, decimals: 0, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: SystemProgram.programId, ...overrides }, data);
  return info(data, TOKEN_PROGRAM_ID);
}
function tokenInfo(owner: PublicKey, amount: bigint, overrides = {}) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: SystemProgram.programId, state: AccountState.Initialized,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: SystemProgram.programId, ...overrides }, data);
  return info(data, TOKEN_PROGRAM_ID);
}
const balanceOf = (key: PublicKey) => AccountLayout.decode(accounts.get(key.toBase58())!.data).amount;
async function marketInfo(overrides = {}) {
  const data = Buffer.alloc(coder.accounts.size("Market"));
  (await coder.accounts.encode("Market", { authority: creator, resolver, token_mint: mint, market_id: Array.from(seed), deadline: new BN(1100),
    pool: pools.map(pool => new BN(pool.toString())), winning_outcome: winning, status: { Resolved: {} }, bump: deriveMarketPda(creator, seed).bump, ...overrides })).copy(data);
  return info(data);
}
async function positionInfo(outcome: 0 | 1, amount = stake, overrides = {}) {
  return info(await coder.accounts.encode("Position", { market, wallet: user.publicKey, outcome, amount: new BN(amount.toString()), claimed: false,
    bump: derivePositionPda(market, user.publicKey, outcome).bump, ...overrides }));
}
const setPosition = async (outcome: 0 | 1, amount = stake, overrides = {}) =>
  accounts.set(derivePositionPda(market, user.publicKey, outcome).address.toBase58(), await positionInfo(outcome, amount, overrides));

beforeEach(async () => {
  creator = Keypair.generate().publicKey; user = Keypair.generate(); // Ephemeral, never persisted or printed.
  market = deriveMarketPda(creator, seed).address; vault = deriveVaultPda(market).address;
  ata = getAssociatedTokenAddressSync(mint, user.publicKey);
  pools = [30n, 70n]; stake = 10n; winning = 0;
  position = derivePositionPda(market, user.publicKey, 0).address;
  sent = undefined; response = undefined; owned = []; markClaimed = true;
  movedToRecipient = payout => payout; afterSend = async () => {};
  accounts = new Map([[program.toBase58(), { ...info(Buffer.alloc(0), SystemProgram.programId), executable: true }],
    [mint.toBase58(), mintInfo()], [market.toBase58(), await marketInfo()], [vault.toBase58(), tokenInfo(market, 100n)],
    [ata.toBase58(), tokenInfo(user.publicKey, 5n)]]);
  await setPosition(0);
  connection = new Connection("http://127.0.0.1:8899");
  vi.spyOn(connection, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  vi.spyOn(connection, "getAccountInfo").mockImplementation(async key => accounts.get(key.toBase58()) ?? null);
  vi.spyOn(connection, "getMultipleAccountsInfo").mockImplementation(async keys => keys.map(key => accounts.get(key.toBase58()) ?? null));
  vi.spyOn(connection, "getTokenAccountsByOwner").mockImplementation(async () => ({ context: { slot: 1 }, value: owned }));
  vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({ blockhash, lastValidBlockHeight: 2000 });
  vi.spyOn(connection, "getMinimumBalanceForRentExemption").mockResolvedValue(2039280);
  vi.spyOn(connection, "getFeeForMessage").mockResolvedValue({ context: { slot: 1 }, value: 5000 });
  vi.spyOn(connection, "getBalance").mockResolvedValue(10000000);
  // Simulates the contract: mark claimed, move tokens vault -> recipient, and record token-balance metadata.
  vi.spyOn(connection, "sendRawTransaction").mockImplementation(async bytes => {
    sent = Transaction.from(bytes);
    const claim = sent.instructions.at(-1)!;
    const positionKey = claim.keys[4].pubkey, recipient = claim.keys[5].pubkey;
    const state = coder.accounts.decode("Position", accounts.get(positionKey.toBase58())!.data);
    const payout = computeClaimPayout(BigInt(state.amount.toString()), pools, state.outcome);
    const message = sent.compileMessage();
    const index = (key: PublicKey) => message.accountKeys.findIndex(item => item.equals(key));
    const entry = (key: PublicKey, amount: bigint): TokenBalance => ({ accountIndex: index(key), mint: mint.toBase58(), owner: "", programId: TOKEN_PROGRAM_ID.toBase58(),
      uiTokenAmount: { amount: amount.toString(), decimals: 0, uiAmount: Number(amount), uiAmountString: amount.toString() } });
    const recipientExisted = accounts.has(recipient.toBase58());
    const vaultBefore = balanceOf(vault), recipientBefore = recipientExisted ? balanceOf(recipient) : 0n;
    const moved = movedToRecipient(payout);
    accounts.set(vault.toBase58(), tokenInfo(market, vaultBefore - moved));
    accounts.set(recipient.toBase58(), tokenInfo(user.publicKey, recipientBefore + moved));
    accounts.set(positionKey.toBase58(), await positionInfo(state.outcome, BigInt(state.amount.toString()), { claimed: markClaimed }));
    response = { slot: 2, transaction: { message, signatures: [] }, meta: { err: null, fee: 5000, preBalances: [], postBalances: [],
      preTokenBalances: [entry(vault, vaultBefore), ...(recipientExisted ? [entry(recipient, recipientBefore)] : [])],
      postTokenBalances: [entry(vault, vaultBefore - moved), entry(recipient, recipientBefore + moved)] } };
    await afterSend(accounts);
    return utils.bytes.bs58.encode(sent.signature!);
  });
  vi.spyOn(connection, "confirmTransaction").mockResolvedValue({ context: { slot: 2 }, value: { err: null } });
  vi.spyOn(connection, "getTransaction").mockImplementation(async () => response as never);
  wallet = { publicKey: user.publicKey, signTransaction: vi.fn(async tx => { if (tx instanceof Transaction) tx.partialSign(user); else tx.sign([user]); return tx; }) };
  adapter = new AnchorMarketAdapter({ connection, clock: () => 2000 });
});

const claim = (options?: ClaimOptions) => adapter.claimWinnings(market.toBase58(), wallet, options);
const expectNoSign = () => { expect(wallet.signTransaction).not.toHaveBeenCalled(); expect(connection.sendRawTransaction).not.toHaveBeenCalled(); };
const simulationError = (logs: string[]) => new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "Transaction simulation failed", logs });

describe("exact claim payout arithmetic", () => {
  it("floors amount * totalPool / winningPool like the contract", () => {
    expect(computeClaimPayout(10n, [30n, 70n], 0)).toBe(33n); // 10 * 100 / 30 = 33.33
    expect(computeClaimPayout(1n, [3n, 7n], 0)).toBe(3n);
    expect(computeClaimPayout(7n, [3n, 7n], 1)).toBe(10n); // sole winner receives everything
  });
  it("is exact above Number.MAX_SAFE_INTEGER and up to u64", () => {
    const big = 9007199254740993n;
    expect(computeClaimPayout(big, [big, big], 1)).toBe(big * 2n);
    expect(computeClaimPayout(U64_MAX - 1n, [U64_MAX - 1n, 1n], 0)).toBe(U64_MAX);
  });
  it.each([[0n, [5n, 5n], 0], [6n, [5n, 5n], 0], [1n, [0n, 5n], 0]] as const)("rejects inconsistent payout inputs %#", (amount, p, w) => {
    expect(() => computeClaimPayout(amount, p as [bigint, bigint], w)).toThrow(/inconsistent/);
  });
  it("rejects pools the contract cannot add in u64", () => { expect(() => computeClaimPayout(1n, [U64_MAX, 1n], 0)).toThrow(/u64/); });
  it("rejects invalid outcomes", () => { expect(() => computeClaimPayout(1n, [1n, 1n], 2 as 0)).toThrow(/Outcome/); });
});

describe("wallet-signed Anchor claims", () => {
  it("signs the exact IDL claim_winnings accounts, confirms, and verifies claimed state and token deltas", async () => {
    const sdk = new Hunch({ mode: "anchor", connection, wallet, clock: () => 2000 });
    const result = await sdk.claimWinnings(market.toBase58());
    expect(sent!.instructions).toHaveLength(1);
    const ix = sent!.instructions[0];
    expect(ix.programId.equals(program)).toBe(true);
    expect(ix.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [user.publicKey.toBase58(), true, true], [market.toBase58(), false, false], [mint.toBase58(), false, false],
      [vault.toBase58(), false, true], [position.toBase58(), false, true], [ata.toBase58(), false, true], [TOKEN_PROGRAM_ID.toBase58(), false, false],
    ]);
    const decoded = coder.instruction.decode(ix.data)!;
    expect(decoded.name).toBe("claim_winnings"); expect(decoded.data).toEqual({});
    expect(sent!.feePayer!.equals(user.publicKey)).toBe(true); expect(sent!.verifySignatures()).toBe(true);
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1); expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    const signature = utils.bytes.bs58.encode(sent!.signature!);
    expect(result).toMatchObject({ payout: 33n, signature, transaction: { mode: "anchor", id: signature, signature, status: "confirmed" },
      position: { id: position.toBase58(), outcome: 0, amount: 10n, claimed: true, payout: 33n },
      verification: { vault: vault.toBase58(), vaultBalance: 67n, tokenAccount: ata.toBase58(), tokenBalance: 38n, tokenAccountCreated: false } });
    expect(connection.getMultipleAccountsInfo).toHaveBeenLastCalledWith([market, position, vault, ata], { commitment: "confirmed", minContextSlot: 2 });
    expect(connection.getTransaction).toHaveBeenCalledWith(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    expect(connection.getMinimumBalanceForRentExemption).not.toHaveBeenCalled();
    expect(await sdk.getPositions(market.toBase58())).toEqual([result.position]);
  });

  it("claims the outcome-1 position when outcome 1 wins, preserving exact large bigints", async () => {
    const big = 9007199254740993n;
    pools = [big, big]; stake = big; winning = 1;
    accounts.set(market.toBase58(), await marketInfo()); accounts.set(vault.toBase58(), tokenInfo(market, big * 2n));
    accounts.delete(position.toBase58()); await setPosition(1);
    const result = await claim();
    expect(result.payout).toBe(big * 2n);
    expect(sent!.instructions[0].keys[4].pubkey.equals(derivePositionPda(market, user.publicKey, 1).address)).toBe(true);
    expect(result.verification!.vaultBalance).toBe(0n);
  });

  it("claims only the winning position when the wallet backed both outcomes", async () => {
    await setPosition(1, 20n);
    expect((await claim()).payout).toBe(33n);
    expect(sent!.instructions[0].keys[4].pubkey.equals(position)).toBe(true);
  });

  it("verifies exact transaction deltas even when other transfers change current balances", async () => {
    afterSend = async map => { map.set(ata.toBase58(), tokenInfo(user.publicKey, balanceOf(ata) + 1000n)); };
    const result = await claim();
    expect(result.payout).toBe(33n); expect(result.verification!.tokenBalance).toBe(1038n);
  });

  it.each([["open", { status: { Active: {} }, winning_outcome: null, deadline: new BN(3000) }], ["closed", { status: { Active: {} }, winning_outcome: null }]] as const)
  ("rejects %s markets as not resolved", async (_name, overrides) => {
    accounts.set(market.toBase58(), await marketInfo(overrides));
    await expect(claim()).rejects.toMatchObject({ code: "MARKET_NOT_RESOLVED" }); expectNoSign();
  });
  it("rejects cancelled markets explicitly (contract has no refunds)", async () => {
    accounts.set(market.toBase58(), await marketInfo({ status: { Cancelled: {} }, winning_outcome: null }));
    await expect(claim()).rejects.toMatchObject({ code: "MARKET_NOT_RESOLVED", message: expect.stringContaining("cancelled") }); expectNoSign();
  });
  it("rejects a wallet that only backed the losing outcome", async () => {
    accounts.delete(position.toBase58()); await setPosition(1);
    await expect(claim()).rejects.toMatchObject({ code: "NO_WINNING_POSITION", message: expect.stringContaining("losing") }); expectNoSign();
  });
  it("rejects a wallet with no position", async () => {
    accounts.delete(position.toBase58());
    await expect(claim()).rejects.toMatchObject({ code: "NO_WINNING_POSITION" }); expectNoSign();
  });
  it("rejects an already claimed position before signing", async () => {
    await setPosition(0, stake, { claimed: true });
    await expect(claim()).rejects.toMatchObject({ code: "ALREADY_CLAIMED" }); expectNoSign();
  });
  it("rejects missing markets and non-PDA identifiers", async () => {
    await expect(adapter.claimWinnings("race-42", wallet)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    accounts.delete(market.toBase58());
    await expect(claim()).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" }); expectNoSign();
  });
  it("refuses non-Devnet before any account read or wallet request", async () => {
    vi.mocked(connection.getGenesisHash).mockResolvedValue("mainnet");
    await expect(claim()).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    expect(connection.getAccountInfo).not.toHaveBeenCalled(); expectNoSign();
  });
  it.each(["market mint", "missing mint", "uninitialized mint", "missing program"])("validates %s before signing", async kind => {
    if (kind === "market mint") accounts.set(market.toBase58(), await marketInfo({ token_mint: creator }));
    if (kind === "missing mint") accounts.delete(mint.toBase58());
    if (kind === "uninitialized mint") accounts.set(mint.toBase58(), mintInfo({ isInitialized: false }));
    if (kind === "missing program") accounts.delete(program.toBase58());
    await expect(claim()).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" }); expectNoSign();
  });
  it.each(["missing vault", "vault authority", "vault mint", "vault below payout"])("rejects %s", async kind => {
    if (kind === "missing vault") accounts.delete(vault.toBase58());
    if (kind === "vault authority") accounts.set(vault.toBase58(), tokenInfo(vault, 100n));
    if (kind === "vault mint") accounts.set(vault.toBase58(), tokenInfo(market, 100n, { mint: creator }));
    if (kind === "vault below payout") accounts.set(vault.toBase58(), tokenInfo(market, 32n));
    await expect(claim()).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); expectNoSign();
  });
  it.each(["wallet", "market", "bump", "owner", "discriminator"])("rejects a position with invalid %s", async kind => {
    const overrides = kind === "wallet" ? { wallet: creator } : kind === "market" ? { market: creator } : kind === "bump" ? { bump: derivePositionPda(market, user.publicKey, 0).bump ^ 1 } : {};
    const account = await positionInfo(0, stake, overrides);
    if (kind === "owner") account.owner = TOKEN_PROGRAM_ID;
    if (kind === "discriminator") account.data[0] ^= 255;
    accounts.set(position.toBase58(), account);
    await expect(claim()).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); expectNoSign();
  });

  it("pays an explicit wallet-owned token account", async () => {
    const other = Keypair.generate().publicKey; accounts.set(other.toBase58(), tokenInfo(user.publicKey, 0n));
    const result = await claim({ tokenAccount: other.toBase58() });
    expect(sent!.instructions[0].keys[5].pubkey.equals(other)).toBe(true);
    expect(result.verification).toMatchObject({ tokenAccount: other.toBase58(), tokenBalance: 33n });
  });
  it.each(["owner", "mint", "frozen", "uninitialized", "program owner"])("rejects a recipient with invalid %s", async kind => {
    const account = tokenInfo(kind === "owner" ? creator : user.publicKey, 0n,
      kind === "mint" ? { mint: creator } : kind === "frozen" ? { state: AccountState.Frozen } : kind === "uninitialized" ? { state: AccountState.Uninitialized } : {});
    if (kind === "program owner") account.owner = program;
    accounts.set(ata.toBase58(), account);
    await expect(claim()).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); expectNoSign();
  });
  it("rejects a missing explicit recipient and conflicting options", async () => {
    await expect(claim({ tokenAccount: creator.toBase58() })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(claim({ tokenAccount: ata.toBase58(), createAssociatedTokenAccount: true })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(claim({ createAssociatedTokenAccount: "yes" as unknown as boolean })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expectNoSign();
  });
  it("pays a deterministic usable owned account when the ATA is absent, skipping frozen accounts", async () => {
    accounts.delete(ata.toBase58());
    const usable = Keypair.generate().publicKey, frozen = Keypair.generate().publicKey;
    const usableAccount = tokenInfo(user.publicKey, 1n);
    accounts.set(usable.toBase58(), usableAccount);
    owned = [{ pubkey: frozen, account: tokenInfo(user.publicKey, 0n, { state: AccountState.Frozen }) }, { pubkey: usable, account: usableAccount }];
    const result = await claim();
    expect(result.verification).toMatchObject({ tokenAccount: usable.toBase58(), tokenBalance: 34n, tokenAccountCreated: false });
    expect(sent!.instructions).toHaveLength(1);
  });
  it("requires an explicit choice when the wallet has no usable token account", async () => {
    accounts.delete(ata.toBase58());
    await expect(claim()).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("createAssociatedTokenAccount") }); expectNoSign();
  });
  it("creates a missing ATA atomically in the same signed transaction and pays it", async () => {
    accounts.delete(ata.toBase58());
    const result = await claim({ createAssociatedTokenAccount: true });
    expect(sent!.instructions).toHaveLength(2);
    const create = sent!.instructions[0];
    expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(Array.from(create.data)).toEqual([1]); // CreateIdempotent
    expect(create.keys.map(k => k.pubkey.toBase58())).toEqual([user.publicKey, ata, user.publicKey, mint, SystemProgram.programId, TOKEN_PROGRAM_ID].map(k => k.toBase58()));
    expect(sent!.instructions[1].keys[5].pubkey.equals(ata)).toBe(true);
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(connection.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(165, "confirmed");
    expect(result.verification).toMatchObject({ tokenAccount: ata.toBase58(), tokenBalance: 33n, tokenAccountCreated: true });
  });
  it("prevents recipient balance overflow", async () => {
    accounts.set(ata.toBase58(), tokenInfo(user.publicKey, U64_MAX - 32n));
    await expect(claim()).rejects.toMatchObject({ code: "INVALID_AMOUNT" }); expectNoSign();
  });
  it("checks SOL for fees and new ATA rent", async () => {
    accounts.delete(ata.toBase58()); vi.mocked(connection.getBalance).mockResolvedValue(2044279);
    await expect(claim({ createAssociatedTokenAccount: true })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS", details: { requiredLamports: 2044280 } }); expectNoSign();
  });
  it("does not authorize with an unknown fee estimate", async () => {
    vi.mocked(connection.getFeeForMessage).mockResolvedValue({ context: { slot: 1 }, value: null });
    await expect(claim()).rejects.toMatchObject({ code: "NETWORK_ERROR" }); expectNoSign();
  });
  it.each(["genesis", "accounts", "blockhash"])("wraps %s RPC failures before signing", async kind => {
    if (kind === "genesis") vi.mocked(connection.getGenesisHash).mockRejectedValue(new Error("offline"));
    if (kind === "accounts") vi.mocked(connection.getMultipleAccountsInfo).mockRejectedValue(new Error("offline"));
    if (kind === "blockhash") vi.mocked(connection.getLatestBlockhash).mockRejectedValue(new Error("offline"));
    await expect(claim()).rejects.toMatchObject({ code: "NETWORK_ERROR" }); expectNoSign();
  });

  it.each([null, {}, { publicKey: Keypair.generate().publicKey }, { publicKey: PublicKey.findProgramAddressSync([Buffer.from("x")], program)[0], signTransaction() {} }])
  ("rejects invalid signer %#", async signer => {
    await expect(adapter.claimWinnings(market.toBase58(), signer as WalletSigner)).rejects.toMatchObject({ code: "INVALID_SIGNER" });
    expect(connection.getGenesisHash).not.toHaveBeenCalled();
  });
  it("requires a wallet through Hunch", () => {
    expect(() => new Hunch({ mode: "anchor", connection }).claimWinnings(market.toBase58())).toThrow(/wallet is required/);
  });
  it.each([["reject", "USER_REJECTED"], ["unsigned", "INVALID_SIGNER"], ["changed", "INVALID_SIGNER"]])("handles wallet %s without submission", async (kind, code) => {
    vi.mocked(wallet.signTransaction).mockImplementation(async tx => {
      if (kind === "reject") throw Object.assign(new Error("User rejected the request"), { code: 4001 });
      if (kind === "changed" && tx instanceof Transaction) { tx.recentBlockhash = creator.toBase58(); tx.partialSign(user); }
      return tx;
    });
    await expect(claim()).rejects.toMatchObject({ code }); expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each([["0x1777", "ALREADY_CLAIMED"], ["0x1778", "NO_WINNING_POSITION"], ["0x1775", "MARKET_NOT_RESOLVED"]])
  ("maps program simulation error %s to %s", async (hex, code) => {
    vi.mocked(connection.sendRawTransaction).mockRejectedValue(simulationError([`Program ${program.toBase58()} failed: custom program error: ${hex}`]));
    await expect(claim()).rejects.toMatchObject({ code, details: { stage: "preflight", signature: expect.any(String) } });
    expect(connection.confirmTransaction).not.toHaveBeenCalled();
  });
  it("does not attribute another program's custom error to the contract", async () => {
    vi.mocked(connection.sendRawTransaction).mockRejectedValue(simulationError([`Program ${TOKEN_PROGRAM_ID.toBase58()} failed: custom program error: 0x1777`]));
    await expect(claim()).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
  });
  it("maps a confirmed AlreadyClaimed instruction error, but only for the claim instruction", async () => {
    vi.mocked(connection.confirmTransaction).mockResolvedValue({ context: { slot: 2 }, value: { err: { InstructionError: [0, { Custom: 6007 }] } } });
    await expect(claim()).rejects.toMatchObject({ code: "ALREADY_CLAIMED", details: { signature: expect.any(String) } });
    accounts.delete(ata.toBase58()); await setPosition(0);
    accounts.set(vault.toBase58(), tokenInfo(market, 100n));
    vi.mocked(connection.confirmTransaction).mockResolvedValue({ context: { slot: 2 }, value: { err: { InstructionError: [0, { Custom: 6007 }] } } });
    await expect(claim({ createAssociatedTokenAccount: true })).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
  });
  it.each(["submission", "confirmation"])("reports uncertain %s with the genuine signature and never retries", async stage => {
    if (stage === "submission") vi.mocked(connection.sendRawTransaction).mockRejectedValue(new Error("RPC timeout"));
    else vi.mocked(connection.confirmTransaction).mockRejectedValue(new Error("Block height exceeded"));
    await expect(claim()).rejects.toMatchObject({ code: "TRANSACTION_UNCERTAIN", details: { stage, signature: expect.any(String), marketId: market.toBase58(), expectedPayout: "33" } });
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it.each(["not claimed", "amount changed", "wrong delta", "metadata error", "resolution changed", "missing recipient", "RPC failure"])
  ("reports confirmed verification failure for %s without resubmitting", async kind => {
    if (kind === "not claimed") markClaimed = false;
    if (kind === "wrong delta") movedToRecipient = payout => payout - 1n;
    afterSend = async map => {
      if (kind === "amount changed") map.set(position.toBase58(), await positionInfo(0, stake + 1n, { claimed: true }));
      if (kind === "metadata error") (response as { meta: { err: unknown } }).meta.err = { InstructionError: [0, "Custom"] };
      if (kind === "resolution changed") map.set(market.toBase58(), await marketInfo({ winning_outcome: 1 }));
      if (kind === "missing recipient") map.delete(ata.toBase58());
      if (kind === "RPC failure") vi.mocked(connection.getMultipleAccountsInfo).mockRejectedValue(new Error("RPC read unavailable"));
    };
    await expect(claim()).rejects.toMatchObject({ code: "INVALID_RESPONSE",
      details: { signature: expect.any(String), stage: "verification", confirmationStatus: "confirmed", expectedPayout: "33" } });
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("retries only the metadata read when RPC lags, then reports unverified", async () => {
    afterSend = async () => { response = null; };
    await expect(claim()).rejects.toMatchObject({ code: "INVALID_RESPONSE", details: { confirmationStatus: "confirmed" } });
    expect(connection.getTransaction).toHaveBeenCalledTimes(3);
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("succeeds once lagging metadata becomes available", async () => {
    let calls = 0;
    vi.mocked(connection.getTransaction).mockImplementation(async () => (++calls < 2 ? null : response) as never);
    expect((await claim()).payout).toBe(33n);
  });
});

describe("mock and HTTP claim compatibility", () => {
  it("passes options through Hunch without affecting mock adapters", async () => {
    const mockClaim = vi.fn(async () => ({ payout: 1n, signature: null, transaction: { mode: "mock" as const, id: "mock:1", signature: null, status: "confirmed" as const } }));
    const sdk = new Hunch({ adapter: { mode: "mock", claimWinnings: mockClaim } as never, wallet });
    await sdk.claimWinnings("race-42", { createAssociatedTokenAccount: true });
    expect(mockClaim).toHaveBeenCalledWith("race-42", wallet, { createAssociatedTokenAccount: true });
  });
});

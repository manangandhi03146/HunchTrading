import { beforeEach, describe, expect, it, vi } from "vitest";
import { BN, BorshCoder, utils } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SendTransactionError, SystemProgram, Transaction } from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import { AccountLayout, AccountState, ASSOCIATED_TOKEN_PROGRAM_ID, MintLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, decodeTransferCheckedInstruction } from "@solana/spl-token";
import idl from "../src/idl/marketkit.json";
import { AnchorMarketAdapter, Hunch, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER, HUNCH_PROGRAM_ID, U64_MAX, deriveMarketPda, derivePositionPda, deriveVaultPda } from "../src/index.js";
import type { PredictParams, WalletSigner } from "../src/index.js";

const coder = new BorshCoder(idl as Idl), program = new PublicKey(HUNCH_PROGRAM_ID);
const mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT), resolver = new PublicKey(HUNCH_DEVNET_RESOLVER);
const seed = new Uint8Array(32).fill(2), blockhash = Keypair.generate().publicKey.toBase58();
const info = (data: Buffer, owner = program): AccountInfo<Buffer> => ({ data, owner, executable: false, lamports: 10000000, rentEpoch: 0 });
let creator: PublicKey, user: Keypair, wallet: WalletSigner, connection: Connection, adapter: AnchorMarketAdapter;
let market: PublicKey, position: PublicKey, vault: PublicKey, ata: PublicKey, params: PredictParams, now: number;
let accounts: Map<string, AccountInfo<Buffer>>, owned: { pubkey: PublicKey; account: AccountInfo<Buffer> }[], sent: Transaction | undefined;
let beforeAmount: bigint, beforePool: bigint, beforeVault: bigint, postExtra: bigint;
let postTransform: (map: Map<string, AccountInfo<Buffer>>) => Promise<void>;
function mintInfo(overrides = {}) {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: SystemProgram.programId, supply: 1000000n, decimals: 0, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: SystemProgram.programId, ...overrides }, data);
  return info(data, TOKEN_PROGRAM_ID);
}
function tokenInfo(owner: PublicKey, amount = 1000n, overrides = {}) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: SystemProgram.programId, state: AccountState.Initialized,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: SystemProgram.programId, ...overrides }, data);
  return info(data, TOKEN_PROGRAM_ID);
}
async function marketInfo(overrides = {}) {
  const data = Buffer.alloc(coder.accounts.size("Market"));
  (await coder.accounts.encode("Market", { authority: creator, resolver, token_mint: mint, market_id: Array.from(seed), deadline: new BN(1100),
    pool: [new BN(beforePool.toString()), new BN(0)], winning_outcome: null, status: { Active: {} }, bump: deriveMarketPda(creator, seed).bump, ...overrides })).copy(data);
  return info(data);
}
async function positionInfo(outcome = 0, amount = beforeAmount, overrides = {}) {
  const data = await coder.accounts.encode("Position", { market, wallet: user.publicKey, outcome, amount: new BN(amount.toString()), claimed: false,
    bump: derivePositionPda(market, user.publicKey, outcome as 0 | 1).bump, ...overrides });
  return info(data);
}
beforeEach(async () => {
  creator = Keypair.generate().publicKey; user = Keypair.generate(); now = 1000;
  market = deriveMarketPda(creator, seed).address; position = derivePositionPda(market, user.publicKey, 0).address;
  vault = deriveVaultPda(market).address; ata = getAssociatedTokenAddressSync(mint, user.publicKey);
  beforeAmount = beforePool = beforeVault = postExtra = 0n; sent = undefined; owned = []; postTransform = async () => {};
  params = { marketId: market.toBase58(), outcome: 0, amount: 40n };
  accounts = new Map([[program.toBase58(), { ...info(Buffer.alloc(0), SystemProgram.programId), executable: true }],
    [mint.toBase58(), mintInfo()], [market.toBase58(), await marketInfo()], [ata.toBase58(), tokenInfo(user.publicKey)]]);
  connection = new Connection("http://127.0.0.1:8899");
  vi.spyOn(connection, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  vi.spyOn(connection, "getAccountInfo").mockImplementation(async key => accounts.get(key.toBase58()) ?? null);
  vi.spyOn(connection, "getMultipleAccountsInfo").mockImplementation(async keys => keys.map(key => accounts.get(key.toBase58()) ?? null));
  vi.spyOn(connection, "getTokenAccountsByOwner").mockImplementation(async () => ({ context: { slot: 1 }, value: owned }));
  vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({ blockhash, lastValidBlockHeight: 2000 });
  vi.spyOn(connection, "getMinimumBalanceForRentExemption").mockResolvedValue(2000000);
  vi.spyOn(connection, "getFeeForMessage").mockResolvedValue({ context: { slot: 1 }, value: 5000 });
  vi.spyOn(connection, "getBalance").mockResolvedValue(10000000);
  vi.spyOn(connection, "sendRawTransaction").mockImplementation(async bytes => {
    sent = Transaction.from(bytes);
    const decoded = coder.instruction.decode(sent.instructions.at(-1)!.data)!.data as { outcome: 0 | 1; amount: BN };
    const amount = BigInt(decoded.amount.toString());
    accounts.set(market.toBase58(), await marketInfo({ pool: decoded.outcome === 0 ? [new BN((beforePool + amount + postExtra).toString()), new BN(0)] : [new BN(beforePool.toString()), new BN(amount.toString())] }));
    accounts.set(derivePositionPda(market, user.publicKey, decoded.outcome).address.toBase58(), await positionInfo(decoded.outcome, beforeAmount + amount + postExtra));
    accounts.set(vault.toBase58(), tokenInfo(market, beforeVault + amount + postExtra));
    await postTransform(accounts);
    return utils.bytes.bs58.encode(sent.signature!);
  });
  vi.spyOn(connection, "confirmTransaction").mockResolvedValue({ context: { slot: 2 }, value: { err: null } });
  wallet = { publicKey: user.publicKey, signTransaction: vi.fn(async tx => { if (tx instanceof Transaction) tx.partialSign(user); else tx.sign([user]); return tx; }) };
  adapter = new AnchorMarketAdapter({ connection, clock: () => now });
});

const expectNoSign = () => { expect(wallet.signTransaction).not.toHaveBeenCalled(); expect(connection.sendRawTransaction).not.toHaveBeenCalled(); };

describe("real Anchor predictions", () => {
  it("derives exact position/vault seeds, outcome byte and configured program deterministically", () => {
    const expected = PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), user.publicKey.toBuffer(), Buffer.from([0])], program);
    expect(derivePositionPda(market, user.publicKey, 0)).toEqual({ address: expected[0], bump: expected[1] });
    expect(derivePositionPda(market, user.publicKey, 1).address.equals(position)).toBe(false);
    expect(derivePositionPda(market, creator, 0).address.equals(position)).toBe(false);
    const v = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program);
    expect(deriveVaultPda(market)).toEqual({ address: v[0], bump: v[1] });
    expect(deriveVaultPda(market, creator).address.equals(vault)).toBe(false);
    expect(() => derivePositionPda(market, user.publicKey, 2 as 0)).toThrow(/Outcome/);
  });
  it("signs exact IDL accounts, creates first position/vault, confirms and verifies one recent snapshot", async () => {
    const sdk = new Hunch({ mode: "anchor", connection, wallet, clock: () => now });
    const result = await sdk.predict(params);
    const ix = sent!.instructions[0];
    expect(ix.programId.equals(program)).toBe(true);
    expect(ix.keys.map(x => [x.pubkey.toBase58(), x.isSigner, x.isWritable])).toEqual([
      [user.publicKey.toBase58(), true, true], [market.toBase58(), false, true], [mint.toBase58(), false, false],
      [vault.toBase58(), false, true], [ata.toBase58(), false, true], [position.toBase58(), false, true],
      [TOKEN_PROGRAM_ID.toBase58(), false, false], [SystemProgram.programId.toBase58(), false, false],
    ]);
    const decoded = coder.instruction.decode(ix.data)!;
    expect(decoded.name).toBe("place_prediction"); expect((decoded.data as { amount: BN }).amount.toString()).toBe("40");
    expect(sent!.verifySignatures()).toBe(true); expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(result.position).toMatchObject({ id: position.toBase58(), amount: 40n, wallet: user.publicKey.toBase58(), claimed: false, payout: 0n });
    expect(result.verification).toMatchObject({ market: { pools: [40n, 0n] }, vault: vault.toBase58(), vaultBalance: 40n, tokenAccount: ata.toBase58() });
    expect(result.transaction).toMatchObject({ mode: "anchor", status: "confirmed", signature: utils.bytes.bs58.encode(sent!.signature!) });
    expect(connection.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(165, "confirmed");
    expect(connection.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(83, "confirmed");
    expect(connection.getMultipleAccountsInfo).toHaveBeenLastCalledWith([market, position, vault], { commitment: "confirmed", minContextSlot: 2 });
    expect(await sdk.getPositions(market.toBase58())).toEqual([result.position]);
  });
  it("accumulates repeated stakes and charges no rent for existing accounts", async () => {
    beforeAmount = 75n; beforePool = 200n; beforeVault = 200n;
    accounts.set(market.toBase58(), await marketInfo()); accounts.set(position.toBase58(), await positionInfo()); accounts.set(vault.toBase58(), tokenInfo(market, beforeVault));
    const result = await adapter.predict(params, wallet);
    expect(result.position.amount).toBe(115n); expect(result.verification!.market.pools[0]).toBe(240n); expect(result.verification!.vaultBalance).toBe(240n);
    expect(connection.getMinimumBalanceForRentExemption).not.toHaveBeenCalled();
  });
  it("accepts concurrent additional stakes during verification", async () => { postExtra = 25n; expect((await adapter.predict(params, wallet)).position.amount).toBe(65n); });
  it("stakes outcome 1 using its own PDA", async () => { const result = await adapter.predict({ ...params, outcome: 1 }, wallet); expect(result.position.outcome).toBe(1); expect(result.verification!.market.pools).toEqual([0n, 40n]); });
  it("preserves exact u64 amounts above Number.MAX_SAFE_INTEGER", async () => {
    accounts.set(ata.toBase58(), tokenInfo(user.publicKey, U64_MAX));
    const result = await adapter.predict({ ...params, amount: U64_MAX }, wallet); expect(result.position.amount).toBe(U64_MAX);
    expect((coder.instruction.decode(sent!.instructions[0].data)!.data as { amount: BN }).amount.toString()).toBe(U64_MAX.toString());
  });
  it.each([0n, -1n, U64_MAX + 1n, 1 as unknown as bigint])("rejects invalid amount %s", async amount => { await expect(adapter.predict({ ...params, amount }, wallet)).rejects.toMatchObject({ code: "INVALID_AMOUNT" }); expectNoSign(); });
  it.each([-1, 2, 0.5, NaN])("rejects outcome %s", async outcome => { await expect(adapter.predict({ ...params, outcome: outcome as 0 }, wallet)).rejects.toMatchObject({ code: "INVALID_OUTCOME" }); expectNoSign(); });
  it.each([null, {}, { publicKey: user?.publicKey }, { publicKey: PublicKey.findProgramAddressSync([Buffer.from("invalid signer")], program)[0], signTransaction() {} }])("rejects invalid signer %#", async signer => { await expect(adapter.predict(params, signer as WalletSigner)).rejects.toMatchObject({ code: "INVALID_SIGNER" }); expect(connection.getGenesisHash).not.toHaveBeenCalled(); });
  it("rejects non-Devnet before any account read or wallet request", async () => { vi.mocked(connection.getGenesisHash).mockResolvedValue("mainnet"); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" }); expect(connection.getAccountInfo).not.toHaveBeenCalled(); expectNoSign(); });
  it("rejects missing markets", async () => { accounts.delete(market.toBase58()); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" }); expectNoSign(); });
  it.each([1100, 1101])("rejects deadline boundary at %s", async timestamp => { now = timestamp; await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "MARKET_CLOSED" }); expectNoSign(); });
  it.each(["Resolved", "Cancelled"])("rejects %s markets", async status => { accounts.set(market.toBase58(), await marketInfo({ status: { [status]: {} }, winning_outcome: status === "Resolved" ? 0 : null })); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: status === "Resolved" ? "MARKET_RESOLVED" : "MARKET_CLOSED" }); expectNoSign(); });
  it.each(["wrong market mint", "missing mint", "uninitialized mint", "wrong mint owner", "missing program"])("validates %s before signing", async kind => {
    if (kind === "wrong market mint") accounts.set(market.toBase58(), await marketInfo({ token_mint: creator }));
    if (kind === "missing mint") accounts.delete(mint.toBase58());
    if (kind === "uninitialized mint") accounts.set(mint.toBase58(), mintInfo({ isInitialized: false }));
    if (kind === "wrong mint owner") accounts.set(mint.toBase58(), { ...mintInfo(), owner: program });
    if (kind === "missing program") accounts.delete(program.toBase58());
    await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" }); expectNoSign();
  });
  it.each(["owner", "mint", "frozen", "uninitialized", "program owner", "malformed"])("rejects token account with invalid %s", async kind => {
    let account = tokenInfo(kind === "owner" ? creator : user.publicKey, 1000n, kind === "mint" ? { mint: creator } : kind === "frozen" ? { state: AccountState.Frozen } : kind === "uninitialized" ? { state: AccountState.Uninitialized } : {});
    if (kind === "program owner") account.owner = program;
    if (kind === "malformed") account.data = Buffer.alloc(4);
    accounts.set(ata.toBase58(), account); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); expectNoSign();
  });
  it("rejects insufficient TEST before wallet authorization", async () => { accounts.set(ata.toBase58(), tokenInfo(user.publicKey, 39n)); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" }); expectNoSign(); });
  it("does not create an empty ATA or mint when the wallet owns no TEST", async () => { accounts.delete(ata.toBase58()); await expect(adapter.predict({ ...params, createAssociatedTokenAccount: true }, wallet)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" }); expectNoSign(); });
  it("uses a funded non-associated account when ATA is absent", async () => {
    accounts.delete(ata.toBase58()); const source = Keypair.generate().publicKey; const account = tokenInfo(user.publicKey); owned = [{ pubkey: source, account }];
    const result = await adapter.predict(params, wallet); expect(result.verification!.tokenAccount).toBe(source.toBase58()); expect(sent!.instructions).toHaveLength(1);
  });
  it("skips frozen owned accounts when selecting a funded source", async () => {
    accounts.delete(ata.toBase58()); const source = Keypair.generate().publicKey;
    owned = [{ pubkey: Keypair.generate().publicKey, account: tokenInfo(user.publicKey, 1000n, { state: AccountState.Frozen }) },
      { pubkey: source, account: tokenInfo(user.publicKey) }];
    expect((await adapter.predict(params, wallet)).verification!.tokenAccount).toBe(source.toBase58());
  });
  it("creates and funds a missing ATA atomically from a wallet-owned TEST account", async () => {
    accounts.delete(ata.toBase58()); const source = Keypair.generate().publicKey; owned = [{ pubkey: source, account: tokenInfo(user.publicKey) }];
    const result = await adapter.predict({ ...params, createAssociatedTokenAccount: true }, wallet);
    expect(result.verification!.tokenAccount).toBe(ata.toBase58()); expect(sent!.instructions).toHaveLength(3);
    expect(sent!.instructions[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    const transfer = decodeTransferCheckedInstruction(sent!.instructions[1]);
    expect(transfer.keys.source.pubkey.equals(source)).toBe(true); expect(transfer.keys.destination.pubkey.equals(ata)).toBe(true);
    expect(transfer.keys.owner.pubkey.equals(user.publicKey)).toBe(true); expect(transfer.data).toMatchObject({ amount: 40n, decimals: 0 });
    expect(connection.getMinimumBalanceForRentExemption).toHaveBeenCalledTimes(3);
  });
  it("uses and validates an explicit token account", async () => {
    const source = Keypair.generate().publicKey; accounts.set(source.toBase58(), tokenInfo(user.publicKey));
    expect((await adapter.predict({ ...params, tokenAccount: source.toBase58() }, wallet)).verification!.tokenAccount).toBe(source.toBase58());
  });
  it("rejects a missing explicit account", async () => { await expect(adapter.predict({ ...params, tokenAccount: creator.toBase58() }, wallet)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expectNoSign(); });
  it("rejects conflicting token account/ATA options", async () => { await expect(adapter.predict({ ...params, tokenAccount: ata.toBase58(), createAssociatedTokenAccount: true }, wallet)).rejects.toMatchObject({ code: "INVALID_INPUT" }); expectNoSign(); });
  it.each(["position", "pool", "vault"])("prevents %s accumulation overflow", async kind => {
    if (kind === "position") accounts.set(position.toBase58(), await positionInfo(0, U64_MAX));
    if (kind === "pool") accounts.set(market.toBase58(), await marketInfo({ pool: [new BN(U64_MAX.toString()), new BN(0)] }));
    if (kind === "vault") accounts.set(vault.toBase58(), tokenInfo(market, U64_MAX));
    await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "INVALID_AMOUNT" }); expectNoSign();
  });
  it("validates existing vault authority rather than trusting the vault PDA address", async () => { accounts.set(vault.toBase58(), tokenInfo(vault)); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); expectNoSign(); });
  it("validates existing position wallet", async () => { accounts.set(position.toBase58(), await positionInfo(0, 1n, { wallet: creator })); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); expectNoSign(); });
  it("checks SOL rent plus fees separately from token balance", async () => { vi.mocked(connection.getBalance).mockResolvedValue(4004999); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS", details: { requiredLamports: 4005000 } }); expectNoSign(); });
  it("rejects unknown fee estimates", async () => { vi.mocked(connection.getFeeForMessage).mockResolvedValue({ context: { slot: 1 }, value: null }); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "NETWORK_ERROR" }); expectNoSign(); });
  it.each(["reject", "unsigned", "changed"])("handles wallet %s without submission", async kind => {
    vi.mocked(wallet.signTransaction).mockImplementation(async tx => {
      if (kind === "reject") throw Object.assign(new Error("Rejected"), { code: 4001 });
      if (kind === "changed" && tx instanceof Transaction) { tx.recentBlockhash = creator.toBase58(); tx.partialSign(user); }
      return tx;
    });
    await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: kind === "reject" ? "USER_REJECTED" : "INVALID_SIGNER" }); expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("does not submit if the deadline elapses during signing", async () => { const sign = vi.mocked(wallet.signTransaction).getMockImplementation()!; vi.mocked(wallet.signTransaction).mockImplementation(async tx => { const signed = await sign(tx); now = 1100; return signed; }); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "MARKET_CLOSED" }); expect(connection.sendRawTransaction).not.toHaveBeenCalled(); });
  it.each(["submission", "confirmation"])("reports uncertain %s with the genuine signed signature and never retries", async stage => {
    if (stage === "submission") vi.mocked(connection.sendRawTransaction).mockRejectedValue(new Error("RPC timeout"));
    else vi.mocked(connection.confirmTransaction).mockRejectedValue(new Error("Expired"));
    await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "TRANSACTION_UNCERTAIN", details: { stage, signature: expect.any(String), marketId: market.toBase58() } }); expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("reports RPC simulation rejection as a definitive failure", async () => { vi.mocked(connection.sendRawTransaction).mockRejectedValue(new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "Instruction error", logs: [] })); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "TRANSACTION_FAILED", details: { stage: "preflight" } }); expect(connection.confirmTransaction).not.toHaveBeenCalled(); });
  it("reports on-chain transaction failure", async () => { vi.mocked(connection.confirmTransaction).mockResolvedValue({ context: { slot: 2 }, value: { err: { InstructionError: [0, "Custom"] } } }); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "TRANSACTION_FAILED" }); });
  it.each(["missing position", "missing vault", "position amount", "pool amount", "vault amount", "wrong mint", "RPC failure"])("reports confirmed verification failure for %s, without blind retry", async kind => {
    postTransform = async map => {
      if (kind === "missing position") map.delete(position.toBase58()); if (kind === "missing vault") map.delete(vault.toBase58());
      if (kind === "position amount") map.set(position.toBase58(), await positionInfo(0, 39n));
      if (kind === "pool amount") map.set(market.toBase58(), await marketInfo());
      if (kind === "vault amount") map.set(vault.toBase58(), tokenInfo(market, 39n));
      if (kind === "wrong mint") map.set(market.toBase58(), await marketInfo({ token_mint: creator }));
      if (kind === "RPC failure") vi.mocked(connection.getMultipleAccountsInfo).mockRejectedValue(new Error("RPC read unavailable"));
    };
    await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "INVALID_RESPONSE", details: { signature: expect.any(String), stage: "verification", confirmationStatus: "confirmed" } }); expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("wraps read/preparation RPC failures before signing", async () => { vi.mocked(connection.getMultipleAccountsInfo).mockRejectedValue(new Error("Offline")); await expect(adapter.predict(params, wallet)).rejects.toMatchObject({ code: "NETWORK_ERROR" }); expectNoSign(); });
});

describe("wallet-specific on-chain positions", () => {
  it("returns no positions for a real market and absent PDAs", async () => { expect(await adapter.getPositions(market.toBase58(), user.publicKey.toBase58())).toEqual([]); });
  it("requires only a public address, not a wallet signature", async () => { await expect(adapter.getPositions(market.toBase58())).rejects.toMatchObject({ code: "WALLET_REQUIRED" }); expect(wallet.signTransaction).not.toHaveBeenCalled(); });
  it("reads both outcomes with exact bigints, claimed state and resolved payout", async () => {
    const large = 9007199254740993n;
    accounts.set(market.toBase58(), await marketInfo({ pool: [new BN(large.toString()), new BN(3)], winning_outcome: 0, status: { Resolved: {} } }));
    accounts.set(position.toBase58(), await positionInfo(0, large, { claimed: true }));
    accounts.set(derivePositionPda(market, user.publicKey, 1).address.toBase58(), await positionInfo(1, 3n));
    const result = await adapter.getPositions(market.toBase58(), user.publicKey.toBase58());
    expect(result.map(x => [x.outcome, x.amount, x.claimed, x.payout])).toEqual([[0, large, true, large + 3n], [1, 3n, false, 0n]]);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });
  it.each(["wrong owner", "discriminator", "short", "wallet", "market", "outcome", "bump"])("rejects position with invalid %s", async kind => {
    let account = await positionInfo(0, 1n, kind === "wallet" ? { wallet: creator } : kind === "market" ? { market: creator } : kind === "outcome" ? { outcome: 1 } : kind === "bump" ? { bump: derivePositionPda(market, user.publicKey, 0).bump ^ 1 } : {});
    if (kind === "wrong owner") account.owner = TOKEN_PROGRAM_ID; if (kind === "discriminator") account.data[0] ^= 255; if (kind === "short") account.data = account.data.subarray(0, 82);
    accounts.set(position.toBase58(), account); await expect(adapter.getPositions(market.toBase58(), user.publicKey.toBase58())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects missing markets, invalid addresses and RPC errors explicitly", async () => {
    await expect(adapter.getPositions("slug", user.publicKey.toBase58())).rejects.toMatchObject({ code: "INVALID_INPUT" });
    accounts.delete(market.toBase58()); await expect(adapter.getPositions(market.toBase58(), user.publicKey.toBase58())).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
    vi.mocked(connection.getMultipleAccountsInfo).mockRejectedValue(new Error("Offline")); await expect(adapter.getPositions(market.toBase58(), user.publicKey.toBase58())).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

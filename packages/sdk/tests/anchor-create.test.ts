import { beforeEach, describe, expect, it, vi } from "vitest";
import { BN, BorshCoder, utils } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SendTransactionError, SystemProgram, Transaction } from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import { MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import idl from "../src/idl/marketkit.json";
import {
  AnchorMarketAdapter, Hunch, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_RESOLVER,
  HUNCH_DEVNET_TOKEN_MINT, HUNCH_PROGRAM_ID, deriveMarketPda, generateMarketSeed,
} from "../src/index.js";
import type { CreateMarketParams, WalletSigner } from "../src/index.js";

const coder = new BorshCoder(idl as Idl);
const programId = new PublicKey(HUNCH_PROGRAM_ID);
const mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT);
const resolver = new PublicKey(HUNCH_DEVNET_RESOLVER);
const seed = new Uint8Array(32).fill(42);
const blockhash = new PublicKey(new Uint8Array(32).fill(5)).toBase58();
const info = (data: Buffer, owner: PublicKey): AccountInfo<Buffer> => ({ data, owner, executable: false, lamports: 1, rentEpoch: 0 });

function mintInfo(decimals = 0) {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({
    mintAuthorityOption: 0, mintAuthority: SystemProgram.programId, supply: 1000000n,
    decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: SystemProgram.programId,
  }, data);
  return info(data, TOKEN_PROGRAM_ID);
}

let connection: Connection, adapter: AnchorMarketAdapter, creator: Keypair, wallet: WalletSigner;
let params: CreateMarketParams, now: number, address: PublicKey;
let marketAccount: AccountInfo<Buffer> | null, sent: Transaction | undefined;
async function marketInfo(overrides: Record<string, unknown> = {}) {
  const { bump } = deriveMarketPda(creator.publicKey, seed);
  const data = Buffer.alloc(164);
  (await coder.accounts.encode("Market", {
    authority: creator.publicKey, resolver, token_mint: mint, market_id: Array.from(seed),
    deadline: new BN(1100), pool: [new BN(0), new BN(0)], winning_outcome: null,
    status: { Active: {} }, bump, ...overrides,
  })).copy(data);
  return info(data, programId);
}

beforeEach(async () => {
  now = 1000;
  creator = Keypair.generate(); // Ephemeral, never persisted or printed.
  address = deriveMarketPda(creator.publicKey, seed).address;
  params = { marketSeed: seed, question: "Who wins?", outcomes: ["A", "B"], closesAt: 1100 };
  marketAccount = await marketInfo();
  sent = undefined;
  wallet = {
    publicKey: creator.publicKey,
    signTransaction: vi.fn(async transaction => {
      if (transaction instanceof Transaction) transaction.partialSign(creator);
      else transaction.sign([creator]);
      return transaction;
    }),
  };
  connection = new Connection("http://127.0.0.1:8899");
  vi.spyOn(connection, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  vi.spyOn(connection, "getAccountInfo").mockImplementation(async publicKey => {
    if (publicKey.equals(programId)) return { ...info(Buffer.alloc(0), SystemProgram.programId), executable: true };
    if (publicKey.equals(mint)) return mintInfo();
    if (publicKey.equals(address)) return sent ? marketAccount : null;
    return null;
  });
  vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({ blockhash, lastValidBlockHeight: 2000 });
  vi.spyOn(connection, "getMinimumBalanceForRentExemption").mockResolvedValue(2000000);
  vi.spyOn(connection, "getFeeForMessage").mockResolvedValue({ context: { slot: 1 }, value: 5000 });
  vi.spyOn(connection, "getBalance").mockResolvedValue(10000000);
  vi.spyOn(connection, "sendRawTransaction").mockImplementation(async bytes => {
    sent = Transaction.from(bytes);
    return utils.bytes.bs58.encode(sent.signature!);
  });
  vi.spyOn(connection, "confirmTransaction").mockResolvedValue({ context: { slot: 2 }, value: { err: null } });
  adapter = new AnchorMarketAdapter({ connection, clock: () => now });
});

describe("wallet-signed Anchor creation", () => {
  it("imports the published SDK in a fresh process without a host Buffer global", () => {
    const entry = new URL("../dist/index.js", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      globalThis.Buffer = undefined;
      const sdk = await import(${JSON.stringify(entry)});
      if (typeof globalThis.Buffer !== 'function' || typeof sdk.AnchorMarketAdapter !== 'function') process.exit(1);
      console.log('sdk-import-ok');
    `], { encoding: "utf8", timeout: 15_000 });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe("sdk-import-ok");
  }, 20_000);

  it("derives the exact creator/seed PDA deterministically, independently of wallet signing", () => {
    const creatorKey = new PublicKey(new Uint8Array(32).fill(1));
    const expected = PublicKey.findProgramAddressSync([Buffer.from("market"), creatorKey.toBuffer(), Buffer.from(seed)], programId);
    const first = deriveMarketPda(creatorKey, seed);
    const second = deriveMarketPda(creatorKey, new Uint8Array(seed));
    expect(first.address.equals(expected[0])).toBe(true);
    expect(first.bump).toBe(expected[1]);
    expect(second.address.equals(first.address)).toBe(true);
    expect(deriveMarketPda(creator.publicKey, seed).address.equals(first.address)).toBe(false);
    expect(deriveMarketPda(creatorKey, new Uint8Array(32)).address.equals(first.address)).toBe(false);
  });

  it("generates a full seed using the platform cryptographic RNG", () => {
    const rng = vi.spyOn(globalThis.crypto, "getRandomValues");
    const generated = generateMarketSeed();
    expect(generated).toBeInstanceOf(Uint8Array);
    expect(generated.length).toBe(32);
    expect(rng).toHaveBeenCalledWith(generated);
    rng.mockRestore();
  });

  it.each([0, 31, 33])("rejects a %s-byte seed before RPC or signing", async length => {
    expect(() => deriveMarketPda(creator.publicKey, new Uint8Array(length))).toThrow(/32 bytes/);
    await expect(adapter.createMarket({ ...params, marketSeed: new Uint8Array(length) }, wallet)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(connection.getGenesisHash).not.toHaveBeenCalled();
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it.each([999, 1000, 1000.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid deadline %s", async closesAt => {
    await expect(adapter.createMarket({ ...params, closesAt }, wallet)).rejects.toMatchObject({ code: "INVALID_DEADLINE" });
    expect(connection.getGenesisHash).not.toHaveBeenCalled();
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("builds and signs the actual IDL instruction, confirms, reads and verifies the PDA", async () => {
    const client = new Hunch({ mode: "anchor", connection, wallet, clock: () => now });
    const result = await client.createMarket(params);
    expect(sent).toBeInstanceOf(Transaction);
    expect(sent!.verifySignatures()).toBe(true);
    expect(sent!.feePayer!.equals(creator.publicKey)).toBe(true);
    expect(sent!.recentBlockhash).toBe(blockhash);
    expect(sent!.instructions).toHaveLength(1);
    const instruction = sent!.instructions[0];
    expect(instruction.programId.equals(programId)).toBe(true);
    expect(instruction.keys.map(k => ({ key: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable }))).toEqual([
      { key: creator.publicKey.toBase58(), signer: true, writable: true },
      { key: address.toBase58(), signer: false, writable: true },
      { key: SystemProgram.programId.toBase58(), signer: false, writable: false },
    ]);
    const decoded = coder.instruction.decode(instruction.data)!;
    expect(decoded.name).toBe("create_market");
    expect(decoded.data).toMatchObject({ market_id: Array.from(seed), resolver, token_mint: mint });
    expect((decoded.data as { deadline: BN }).deadline.toString()).toBe("1100");
    const signature = utils.bytes.bs58.encode(sent!.signature!);
    expect(result).toMatchObject({
      market: { id: address.toBase58(), authority: creator.publicKey.toBase58(), tokenMint: mint.toBase58(), resolverAuthority: resolver.toBase58(),
        marketSeed: seed, closesAt: 1100, pools: [0n, 0n], metadata: { question: params.question, outcomes: params.outcomes } },
      marketSeed: seed, signature, transaction: { mode: "anchor", signature, id: signature, status: "confirmed" },
    });
    expect(connection.sendRawTransaction).toHaveBeenCalledWith(expect.any(Buffer), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
    expect(connection.confirmTransaction).toHaveBeenCalledWith({ signature, blockhash, lastValidBlockHeight: 2000 }, "confirmed");
    expect(connection.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(164, "confirmed");
    expect(connection.getAccountInfo).toHaveBeenLastCalledWith(address, "confirmed");
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect((await client.getMarket(result.market.id))!.metadata).toBeNull(); // Labels were never on-chain.
    result.marketSeed![0] = 0;
    expect(params.marketSeed![0]).toBe(42);
    expect(result.market.marketSeed![0]).toBe(42);
  });

  it("generates and returns a reproducible seed when omitted", async () => {
    const { marketSeed: _unused, ...withoutSeed } = params;
    vi.mocked(connection.getAccountInfo).mockImplementation(async publicKey => {
      if (publicKey.equals(programId)) return { ...info(Buffer.alloc(0), SystemProgram.programId), executable: true };
      if (publicKey.equals(mint)) return mintInfo();
      if (!sent) return null;
      const decoded = coder.instruction.decode(sent.instructions[0].data)!.data as { market_id: number[] };
      const actualSeed = new Uint8Array(decoded.market_id);
      const { address: pda, bump } = deriveMarketPda(creator.publicKey, actualSeed);
      const account = await marketInfo({ market_id: decoded.market_id, bump });
      return publicKey.equals(pda) ? account : null;
    });
    const result = await adapter.createMarket(withoutSeed, wallet);
    expect(result.marketSeed).toHaveLength(32);
    expect(deriveMarketPda(creator.publicKey, result.marketSeed!).address.toBase58()).toBe(result.market.id);
  });

  it("creates without a global Buffer, as in a browser wallet application", async () => {
    const account = mintInfo();
    const base = vi.mocked(connection.getAccountInfo).getMockImplementation()!;
    vi.mocked(connection.getAccountInfo).mockImplementation(async key => key.equals(mint) ? account : base(key));
    vi.stubGlobal("Buffer", undefined);
    try {
      const browserAdapter = new AnchorMarketAdapter({ connection, clock: () => now });
      const result = await browserAdapter.createMarket(params, wallet);
      expect(result.market.id).toBe(address.toBase58());
      expect(result.transaction.status).toBe("confirmed");
    } finally { vi.unstubAllGlobals(); }
  });

  it("snapshots seed and metadata before awaiting RPC", async () => {
    const inputSeed = new Uint8Array(seed);
    const input = { ...params, marketSeed: inputSeed, outcomes: ["A", "B"] as [string, string] };
    vi.mocked(connection.getGenesisHash).mockImplementation(async () => {
      inputSeed.fill(1); input.outcomes[0] = "changed"; input.closesAt = 1000;
      return HUNCH_DEVNET_GENESIS_HASH;
    });
    const result = await adapter.createMarket(input, wallet);
    expect(result.marketSeed).toEqual(seed);
    expect(result.market.closesAt).toBe(1100);
    expect(result.market.metadata!.outcomes).toEqual(["A", "B"]);
  });

  it("accepts a matching canonical ID and rejects a slug", async () => {
    await expect(adapter.createMarket({ ...params, id: "race-42" }, wallet)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await adapter.createMarket({ ...params, id: address.toBase58() }, wallet)).market.id).toBe(address.toBase58());
  });

  it.each(["mainnet-genesis", "testnet-genesis"])("refuses %s even behind a Devnet-looking RPC URL", async genesis => {
    vi.mocked(connection.getGenesisHash).mockResolvedValue(genesis);
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    expect(connection.getAccountInfo).not.toHaveBeenCalled();
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("validates configured public keys and per-market resolver before RPC", async () => {
    expect(() => new AnchorMarketAdapter({ tokenMint: "invalid" })).toThrow(/mint/);
    expect(() => new AnchorMarketAdapter({ resolverAuthority: "invalid" })).toThrow(/resolver/);
    await expect(adapter.createMarket({ ...params, resolverAuthority: "invalid" }, wallet)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(connection.getGenesisHash).not.toHaveBeenCalled();
  });

  it("uses explicit configured mint and resolver arguments", async () => {
    const alternateMint = Keypair.generate().publicKey, alternateResolver = Keypair.generate().publicKey;
    marketAccount = await marketInfo({ token_mint: alternateMint, resolver: alternateResolver });
    const base = vi.mocked(connection.getAccountInfo).getMockImplementation()!;
    vi.mocked(connection.getAccountInfo).mockImplementation(async publicKey => publicKey.equals(alternateMint) ? mintInfo(6) : base(publicKey));
    const configured = new AnchorMarketAdapter({ connection, clock: () => now, tokenMint: alternateMint.toBase58(), resolverAuthority: alternateResolver.toBase58() });
    const result = await configured.createMarket(params, wallet);
    expect(result.market.tokenMint).toBe(alternateMint.toBase58());
    expect(result.market.resolverAuthority).toBe(alternateResolver.toBase58());
  });

  it.each(["missing mint", "wrong mint owner", "malformed mint", "uninitialized mint", "program absent", "duplicate"])("fails preflight for %s", async kind => {
    const base = vi.mocked(connection.getAccountInfo).getMockImplementation()!;
    vi.mocked(connection.getAccountInfo).mockImplementation(async publicKey => {
      if (kind === "program absent" && publicKey.equals(programId)) return null;
      if (kind === "duplicate" && publicKey.equals(address)) return marketAccount;
      if (publicKey.equals(mint)) {
        if (kind === "missing mint") return null;
        if (kind === "wrong mint owner") return { ...mintInfo(), owner: SystemProgram.programId };
        if (kind === "malformed mint") return info(Buffer.alloc(3), TOKEN_PROGRAM_ID);
        if (kind === "uninitialized mint") { const account = mintInfo(); account.data[MintLayout.offsetOf("isInitialized")!] = 0; return account; }
      }
      return base(publicKey);
    });
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: kind === "duplicate" ? "MARKET_EXISTS" : "CONFIGURATION_ERROR" });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects insufficient SOL before wallet authorization", async () => {
    vi.mocked(connection.getBalance).mockResolvedValue(2004999);
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS", details: { requiredLamports: 2005000 } });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it.each(["genesis", "account", "blockhash", "fee", "balance", "rent"])("handles %s RPC failure before signing", async stage => {
    const method = { genesis: "getGenesisHash", account: "getAccountInfo", blockhash: "getLatestBlockhash", fee: "getFeeForMessage", balance: "getBalance", rent: "getMinimumBalanceForRentExemption" }[stage]!;
    vi.mocked(connection[method as "getGenesisHash"]).mockRejectedValue(new Error("RPC unavailable"));
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("does not authorize with an unavailable fee estimate", async () => {
    vi.mocked(connection.getFeeForMessage).mockResolvedValue({ context: { slot: 1 }, value: null });
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("reports wallet rejection without submission", async () => {
    vi.mocked(wallet.signTransaction).mockRejectedValue(Object.assign(new Error("User rejected"), { code: 4001 }));
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "USER_REJECTED" });
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each(["unsigned", "wrong signer", "changed message", "wallet error"])("rejects %s without submission", async kind => {
    vi.mocked(wallet.signTransaction).mockImplementation(async transaction => {
      if (kind === "wallet error") throw new Error("Wallet disconnected");
      const tx = transaction as Transaction;
      if (kind === "changed message") { tx.recentBlockhash = SystemProgram.programId.toBase58(); tx.partialSign(creator); }
      if (kind === "wrong signer") tx.addSignature(creator.publicKey, Buffer.alloc(64, 1));
      return transaction;
    });
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "INVALID_SIGNER" });
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("requires an actual signer, and Hunch requires a wallet for creation", async () => {
    await expect(adapter.createMarket(params, { publicKey: address, signTransaction: wallet.signTransaction })).rejects.toMatchObject({ code: "INVALID_SIGNER" });
    expect(() => new Hunch({ mode: "anchor", connection }).createMarket(params)).toThrow(/wallet is required/);
    expect(connection.getGenesisHash).not.toHaveBeenCalled();
  });

  it.each(["before signing", "during signing"])("stops if deadline elapses %s", async stage => {
    if (stage === "before signing") vi.mocked(connection.getBalance).mockImplementation(async () => { now = 1100; return 10000000; });
    else {
      vi.mocked(wallet.signTransaction).mockImplementation(async tx => { (tx as Transaction).partialSign(creator); now = 1100; return tx; });
    }
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "INVALID_DEADLINE" });
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
    if (stage === "before signing") expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["account already in use", "MARKET_EXISTS"], ["insufficient lamports", "INSUFFICIENT_FUNDS"], ["custom program error: 0x1770", "TRANSACTION_FAILED"],
  ])("handles definitive simulation error: %s", async (transactionMessage, code) => {
    vi.mocked(connection.sendRawTransaction).mockRejectedValue(new SendTransactionError({ action: "simulate", signature: "", transactionMessage }));
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code, details: { marketId: address.toBase58(), signature: expect.any(String), stage: "preflight" } });
    expect(connection.confirmTransaction).not.toHaveBeenCalled();
  });

  it.each(["transport", "wrong signature"])("does not claim success after uncertain submission: %s", async kind => {
    if (kind === "transport") vi.mocked(connection.sendRawTransaction).mockRejectedValue(new Error("Connection lost after send"));
    else vi.mocked(connection.sendRawTransaction).mockResolvedValue("incorrect-signature");
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "TRANSACTION_UNCERTAIN", details: { marketId: address.toBase58(), signature: expect.any(String), stage: "submission" } });
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(connection.confirmTransaction).not.toHaveBeenCalled();
  });

  it("reports confirmation expiry as uncertain and never rebroadcasts", async () => {
    vi.mocked(connection.confirmTransaction).mockRejectedValue(new Error("Block height exceeded"));
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "TRANSACTION_UNCERTAIN", details: { stage: "confirmation", signature: expect.any(String) } });
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("reports an on-chain execution error without a success receipt", async () => {
    vi.mocked(connection.confirmTransaction).mockResolvedValue({ context: { slot: 2 }, value: { err: { InstructionError: [0, { Custom: 6000 }] } } });
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "TRANSACTION_FAILED", details: { signature: expect.any(String) } });
  });

  it.each(["missing", "creator", "seed", "deadline", "mint", "resolver", "RPC"])("verifies confirmed state and rejects mismatched %s", async kind => {
    if (kind === "missing") marketAccount = null;
    if (kind === "creator") marketAccount = await marketInfo({ authority: Keypair.generate().publicKey });
    if (kind === "seed") marketAccount = await marketInfo({ market_id: Array(32).fill(1) });
    if (kind === "deadline") marketAccount = await marketInfo({ deadline: new BN(1200) });
    if (kind === "mint") marketAccount = await marketInfo({ token_mint: Keypair.generate().publicKey });
    if (kind === "resolver") marketAccount = await marketInfo({ resolver: Keypair.generate().publicKey });
    if (kind === "RPC") {
      const base = vi.mocked(connection.getAccountInfo).getMockImplementation()!;
      vi.mocked(connection.getAccountInfo).mockImplementation(async key => { if (sent) throw new Error("RPC offline"); return base(key); });
    }
    await expect(adapter.createMarket(params, wallet)).rejects.toMatchObject({ code: "INVALID_RESPONSE", details: { stage: "verification", confirmationStatus: "confirmed", signature: expect.any(String) } });
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it("refuses the opt-in creation script without deliberate authorization", () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/devnet-create-market.mjs", import.meta.url))], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--authorize-devnet-create");
    expect(result.stdout).not.toContain("signature");
  });
});

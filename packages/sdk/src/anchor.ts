import { Program, utils } from "@coral-xyz/anchor";
import type { IdlAccounts } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";
import { Connection, PublicKey, SendTransactionError, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction } from "@solana/web3.js";
import { ACCOUNT_SIZE, TOKEN_PROGRAM_ID, unpackMint, unpackAccount, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import type { AccountInfo, GetProgramAccountsFilter, MessageV0 } from "@solana/web3.js";
import idl from "./idl/marketkit.json" with { type: "json" };
import type { Marketkit } from "./idl/marketkit.js";
import { HunchError } from "./types.js";
import type { HunchErrorCode, ClaimOptions, ResolveOptions } from "./types.js";
import type {
  HunchConfig, MarketAdapter, CreateMarketParams, CreateMarketResult, Market,
  ListMarketsParams, PredictParams, PredictResult, Position, WalletSigner,
  ClaimResult, TransactionResult, TransactionStatusResult, Outcome,
} from "./types.js";

export const HUNCH_PROGRAM_ID = idl.address;
export const HUNCH_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const HUNCH_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const HUNCH_DEVNET_TOKEN_MINT = "9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs";
export const HUNCH_DEVNET_RESOLVER = "6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt";
export const ANCHOR_INTEGRATION_REQUIREMENTS = [
  "Off-chain metadata registration",
] as const;

type ChainMarket = IdlAccounts<Marketkit>["market"];
type ChainPosition = IdlAccounts<Marketkit>["position"];
export const U64_MAX = (1n << 64n) - 1n;

// Contract MarketError codes (IDL `errors`) that map onto stable SDK errors.
const PROGRAM_ERRORS: Readonly<Record<number, HunchErrorCode>> = {
  6002: "MARKET_CLOSED", 6003: "MARKET_CLOSED", 6005: "MARKET_NOT_RESOLVED",
  6007: "ALREADY_CLAIMED", 6008: "NO_WINNING_POSITION",
};
// resolve_market reuses MarketNotActive for an already settled market. 6004 is raised only by
// the proposed deadline fix; 2001 is Anchor's has_one violation for a different resolver.
const RESOLUTION_ERRORS: Readonly<Record<number, HunchErrorCode>> = {
  6001: "INVALID_OUTCOME", 6002: "MARKET_RESOLVED", 6004: "MARKET_NOT_CLOSED", 6006: "UNAUTHORIZED", 2001: "UNAUTHORIZED",
};
type Operation = "market creation" | "prediction" | "claim" | "resolution";
const METADATA_ATTEMPTS = 3, METADATA_DELAY_MS = 400;
const SYSVAR_OWNER = "Sysvar1111111111111111111111111111111111111";

/** Floor(amount * totalPool / winningPool), exactly as `claim_winnings` computes it. */
export function computeClaimPayout(amount: bigint, pools: readonly [bigint, bigint], winningOutcome: Outcome): bigint {
  validateOutcome(winningOutcome);
  const totalPool = pools[0] + pools[1], winningPool = pools[winningOutcome];
  if (amount <= 0n || winningPool <= 0n || amount > winningPool) throw new HunchError("INVALID_RESPONSE", "Position amount is inconsistent with the winning pool");
  // The contract adds the pools in u64 and narrows the payout to u64; either overflow aborts the claim.
  if (totalPool > U64_MAX) throw new HunchError("INVALID_RESPONSE", "Market pools exceed u64; the contract cannot compute this payout");
  const payout = amount * totalPool / winningPool;
  if (payout > U64_MAX) throw new HunchError("INVALID_RESPONSE", "Payout exceeds u64; the contract cannot transfer it");
  return payout;
}

function validateOutcome(outcome: number): asserts outcome is Outcome {
  if (outcome !== 0 && outcome !== 1) throw new HunchError("INVALID_OUTCOME", "Outcome must be 0 or 1");
}

export function derivePositionPda(market: PublicKey, wallet: PublicKey, outcome: Outcome, programId = new PublicKey(HUNCH_PROGRAM_ID)) {
  validateOutcome(outcome);
  const [address, bump] = PublicKey.findProgramAddressSync([new TextEncoder().encode("position"), market.toBytes(), wallet.toBytes(), Uint8Array.of(outcome)], programId);
  return { address, bump };
}

export function deriveVaultPda(market: PublicKey, programId = new PublicKey(HUNCH_PROGRAM_ID)) {
  const [address, bump] = PublicKey.findProgramAddressSync([new TextEncoder().encode("vault"), market.toBytes()], programId);
  return { address, bump };
}

function copyMarketSeed(seed: Uint8Array): Uint8Array {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new HunchError("INVALID_INPUT", "marketSeed must be exactly 32 bytes");
  }
  return Uint8Array.from(seed);
}

/** Cryptographically random public seed; persist it before requesting wallet approval. */
export function generateMarketSeed(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export function deriveMarketPda(creator: PublicKey, seed: Uint8Array, programId = new PublicKey(HUNCH_PROGRAM_ID)) {
  const [address, bump] = PublicKey.findProgramAddressSync([
    new TextEncoder().encode("market"), creator.toBytes(), copyMarketSeed(seed),
  ], programId);
  return { address, bump };
}

/** Real account reads, wallet-signed Devnet creation, predictions and claims, and server-side resolution. */
export class AnchorMarketAdapter implements MarketAdapter {
  readonly mode = "anchor" as const;
  readonly connection: Connection;
  readonly programId: PublicKey;
  private readonly program: Program<Marketkit>;
  private readonly marketSize: number;
  private readonly positionSize: number;
  private readonly now: () => number;
  private readonly mint: PublicKey;
  private readonly resolver: PublicKey;

  constructor(config: Pick<HunchConfig, "rpcUrl" | "programId" | "connection" | "clock" | "tokenMint" | "resolverAuthority"> = {}) {
    // Installed Anchor Borsh and SPL codecs reference global Buffer at runtime.
    // Supply their browser polyfill without requiring changes in consuming apps.
    globalThis.Buffer ??= Buffer;
    try {
      this.programId = new PublicKey(config.programId ?? HUNCH_PROGRAM_ID);
      this.connection = config.connection ?? new Connection(config.rpcUrl ?? HUNCH_DEVNET_RPC_URL, "confirmed");
      this.mint = new PublicKey(config.tokenMint ?? HUNCH_DEVNET_TOKEN_MINT);
      this.resolver = new PublicKey(config.resolverAuthority ?? HUNCH_DEVNET_RESOLVER);
    } catch (cause) {
      throw new HunchError("CONFIGURATION_ERROR", "Anchor requires valid program, mint, resolver public keys and an RPC URL", undefined, { cause });
    }
    // Anchor converts the committed snake_case JSON to the generated camelCase type.
    // A connection-only provider permits reads without a wallet or global provider.
    this.program = new Program<Marketkit>(
      { ...idl, address: this.programId.toBase58() } as unknown as Marketkit,
      { connection: this.connection },
    );
    this.marketSize = this.program.coder.accounts.size("market");
    this.positionSize = this.program.coder.accounts.size("position");
    this.now = config.clock ?? (() => Math.floor(Date.now() / 1000));
  }

  private publicKey(value: string): PublicKey {
    try { return new PublicKey(value); }
    catch (cause) { throw new HunchError("INVALID_INPUT", "Expected a Solana public key; real market IDs are Market PDA addresses", undefined, { cause }); }
  }

  private timestamp(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now)) throw new HunchError("CONFIGURATION_ERROR", "clock must return safe integer Unix seconds");
    return now;
  }

  private decode(address: PublicKey, account: AccountInfo<Buffer>, now: number): Market {
    try {
      if (!account.owner.equals(this.programId) || account.executable) throw new Error("Account is not owned data for the configured program");
      if (account.data.length !== this.marketSize) throw new Error("Invalid Market account size");
      // decode checks the IDL's Market discriminator before decoding any fields.
      const state = this.program.coder.accounts.decode<ChainMarket>("market", account.data);
      const [expected, bump] = PublicKey.findProgramAddressSync([
        new TextEncoder().encode("market"), state.authority.toBytes(), Uint8Array.from(state.marketId),
      ], this.programId);
      if (!expected.equals(address) || bump !== state.bump) throw new Error("Market PDA does not match its stored seeds and bump");
      const deadline = BigInt(state.deadline.toString(10));
      if (deadline > BigInt(Number.MAX_SAFE_INTEGER) || deadline < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new Error("Deadline cannot be represented as safe integer Unix seconds");
      }
      const closesAt = Number(deadline);
      const chainStatus = Object.keys(state.status)[0];
      if (!["active", "resolved", "cancelled"].includes(chainStatus)) throw new Error("Unknown Market status");
      const winningOutcome = state.winningOutcome;
      if (winningOutcome !== null && winningOutcome !== 0 && winningOutcome !== 1) throw new Error("Invalid winning outcome");
      if (chainStatus === "resolved" && winningOutcome === null) throw new Error("Resolved market has no winner");
      if (chainStatus === "active" && winningOutcome !== null) throw new Error("Active market already has a winner");
      const pools: [bigint, bigint] = [BigInt(state.pool[0].toString(10)), BigInt(state.pool[1].toString(10))];
      return {
        id: address.toBase58(), authority: state.authority.toBase58(), resolverAuthority: state.resolver.toBase58(),
        tokenMint: state.tokenMint.toBase58(), closesAt, pools, totalPool: pools[0] + pools[1], winningOutcome,
        marketSeed: Uint8Array.from(state.marketId),
        status: chainStatus === "active" ? (now >= closesAt ? "closed" : "open") : chainStatus as "resolved" | "cancelled",
        // The contract contains no question or labels. Hosts can hydrate metadata by PDA.
        metadata: null,
      };
    } catch (cause) {
      throw new HunchError("INVALID_RESPONSE", "Invalid on-chain Market account", { marketId: address.toBase58() }, { cause });
    }
  }

  async getMarket(marketId: string): Promise<Market | null> {
    const address = this.publicKey(marketId);
    let account: AccountInfo<Buffer> | null;
    try { account = await this.connection.getAccountInfo(address, "confirmed"); }
    catch (cause) { throw new HunchError("NETWORK_ERROR", "Failed to read the on-chain market", undefined, { cause }); }
    return account === null ? null : this.decode(address, account, this.timestamp());
  }

  async listMarkets(params: ListMarketsParams = {}): Promise<Market[]> {
    const authority = params.authority === undefined ? undefined : this.publicKey(params.authority).toBase58();
    if (params.status !== undefined && !["open", "closed", "resolved", "cancelled"].includes(params.status)) {
      throw new HunchError("INVALID_INPUT", "Invalid market status filter");
    }
    const filters: GetProgramAccountsFilter[] = [
      { dataSize: this.marketSize }, { memcmp: this.program.coder.accounts.memcmp("market") },
    ];
    // Authority is the first field after the committed IDL's eight-byte discriminator.
    if (authority) filters.push({ memcmp: { offset: 8, bytes: authority } });
    let accounts;
    try { accounts = await this.connection.getProgramAccounts(this.programId, { commitment: "confirmed", filters }); }
    catch (cause) { throw new HunchError("NETWORK_ERROR", "Failed to list on-chain markets", undefined, { cause }); }
    const now = this.timestamp();
    return accounts.map(({ pubkey, account }) => this.decode(pubkey, account, now)).filter((market) =>
      (!authority || market.authority === authority) && (!params.status || market.status === params.status));
  }

  async createMarket(params: CreateMarketParams, signer: WalletSigner): Promise<CreateMarketResult> {
    if (!signer || !(signer.publicKey instanceof PublicKey) || !PublicKey.isOnCurve(signer.publicKey.toBytes()) || typeof signer.signTransaction !== "function") {
      throw new HunchError("INVALID_SIGNER", "Creation requires a connected wallet with a public key and signTransaction");
    }
    const creator = new PublicKey(signer.publicKey.toBytes());
    const signTransaction = signer.signTransaction.bind(signer);
    const deadline = params.closesAt;
    if (!Number.isSafeInteger(deadline) || deadline <= this.timestamp()) {
      throw new HunchError("INVALID_DEADLINE", "closesAt must be safe integer Unix seconds in the future");
    }
    if (typeof params.question !== "string" || !params.question.trim() || !Array.isArray(params.outcomes) || params.outcomes.length !== 2 ||
        params.outcomes.some(label => typeof label !== "string" || !label.trim()) ||
        (params.description !== undefined && typeof params.description !== "string")) {
      throw new HunchError("INVALID_INPUT", "Supply a question and exactly two outcome labels for off-chain metadata");
    }
    const metadata = { question: params.question, outcomes: [...params.outcomes] as [string, string], ...(params.description === undefined ? {} : { description: params.description }) };
    const seed = params.marketSeed === undefined ? generateMarketSeed() : copyMarketSeed(params.marketSeed);
    const { address } = deriveMarketPda(creator, seed, this.programId);
    if (params.id !== undefined && params.id !== address.toBase58()) {
      throw new HunchError("INVALID_INPUT", "Anchor market id must equal its derived PDA; use marketSeed for reproducibility");
    }
    const resolver = params.resolverAuthority === undefined ? this.resolver : this.publicKey(params.resolverAuthority);
    if (!PublicKey.isOnCurve(resolver.toBytes())) throw new HunchError("INVALID_INPUT", "Resolver must be a public key capable of signing");
    const details = { marketId: address.toBase58(), marketSeed: Array.from(seed, byte => byte.toString(16).padStart(2, "0")).join("") };

    // An endpoint name is insufficient: verify the actual cluster before any wallet request.
    try {
      if (await this.connection.getGenesisHash() !== HUNCH_DEVNET_GENESIS_HASH) {
        throw new HunchError("CONFIGURATION_ERROR", "Market creation is restricted to Solana Devnet", details);
      }
      const [programAccount, mintAccount, existing] = await Promise.all([
        this.connection.getAccountInfo(this.programId, "confirmed"),
        this.connection.getAccountInfo(this.mint, "confirmed"),
        this.connection.getAccountInfo(address, "confirmed"),
      ]);
      if (!programAccount?.executable) throw new HunchError("CONFIGURATION_ERROR", "Configured program is not deployed", details);
      if (existing !== null) throw new HunchError("MARKET_EXISTS", "Market PDA already exists; read it or choose a new seed", details);
      try {
        // The current contract uses classic SPL tokens; amounts are base units.
        const mint = unpackMint(this.mint, mintAccount, TOKEN_PROGRAM_ID);
        if (!mint.isInitialized || mintAccount?.executable) throw new Error("Expected an initialized mint");
      } catch (cause) {
        throw new HunchError("CONFIGURATION_ERROR", "Creation requires an initialized classic SPL mint", details, { cause });
      }
    } catch (cause) {
      if (cause instanceof HunchError) throw cause;
      throw new HunchError("NETWORK_ERROR", "Devnet creation preflight failed", details, { cause });
    }

    let transaction: Transaction;
    let blockhash: string, lastValidBlockHeight: number;
    try {
      const instruction = await this.program.methods.createMarket(Array.from(seed), new BN(deadline.toString()), resolver, this.mint)
        .accountsStrict({ authority: creator, market: address, systemProgram: SystemProgram.programId }).instruction();
      ({ blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed"));
      transaction = new Transaction({ feePayer: creator, blockhash, lastValidBlockHeight }).add(instruction);
      const [rent, fee, balance] = await Promise.all([
        this.connection.getMinimumBalanceForRentExemption(this.marketSize, "confirmed"),
        this.connection.getFeeForMessage(transaction.compileMessage(), "confirmed"),
        this.connection.getBalance(creator, "confirmed"),
      ]);
      if (fee.value === null) throw new HunchError("NETWORK_ERROR", "RPC could not estimate the transaction fee", details);
      if (balance < rent + fee.value) throw new HunchError("INSUFFICIENT_FUNDS", "Wallet needs Devnet SOL for Market rent and transaction fees", { ...details, requiredLamports: rent + fee.value, balanceLamports: balance });
    } catch (cause) {
      if (cause instanceof HunchError) throw cause;
      throw new HunchError("NETWORK_ERROR", "Could not prepare the market transaction", details, { cause });
    }
    const { signature } = await this.authorizeAndSubmit(transaction, signTransaction, deadline, details, "market creation");
    const submitted = { ...details, signature };
    try {
      const market = await this.getMarket(address.toBase58());
      if (!market || market.authority !== creator.toBase58() || market.closesAt !== deadline ||
          market.tokenMint !== this.mint.toBase58() || market.resolverAuthority !== resolver.toBase58() ||
          !market.marketSeed || market.marketSeed.length !== seed.length || !seed.every((byte, index) => market.marketSeed![index] === byte)) {
        throw new Error("Created market does not match requested state");
      }
      return {
        market: { ...market, metadata }, marketSeed: Uint8Array.from(seed), signature,
        transaction: { mode: "anchor", id: signature, signature, status: "confirmed" },
      };
    } catch (cause) {
      throw new HunchError("INVALID_RESPONSE", "Transaction confirmed, but created market verification failed; do not recreate blindly", { ...submitted, stage: "verification", confirmationStatus: "confirmed" }, { cause });
    }
  }
  private async authorizeAndSubmit(
    transaction: Transaction, signTransaction: WalletSigner["signTransaction"], deadline: number | null,
    details: Readonly<Record<string, unknown>>, operation: Operation, onSigned?: ResolveOptions["onSigned"],
  ): Promise<{ signature: string; slot: number }> {
    const deadlineCode = operation === "market creation" ? "INVALID_DEADLINE" : "MARKET_CLOSED";
    const blockhash = transaction.recentBlockhash!;
    const lastValidBlockHeight = transaction.lastValidBlockHeight!;
    // Only errors raised by this program's instruction (always the last) map to SDK codes.
    const programIndex = transaction.instructions.length - 1;
    const errors = operation === "resolution" ? RESOLUTION_ERRORS : PROGRAM_ERRORS;
    if (deadline !== null && deadline <= this.timestamp()) throw new HunchError(deadlineCode, "Deadline elapsed before wallet authorization", details);
    const message = transaction.serializeMessage();
    let signed: Transaction;
    try {
      const result = await signTransaction(transaction);
      if (!(result instanceof Transaction) || !message.equals(result.serializeMessage()) || !result.signature || !result.verifySignatures()) {
        throw new HunchError("INVALID_SIGNER", `Wallet must sign the unchanged ${operation} transaction`, details);
      }
      signed = result;
    } catch (cause) {
      if (cause instanceof HunchError) throw cause;
      const error = cause as { code?: number; message?: string; cause?: { code?: number } } | null;
      const rejected = error?.code === 4001 || error?.cause?.code === 4001 || /reject|declin|cancel/i.test(error?.message ?? "");
      throw new HunchError(rejected ? "USER_REJECTED" : "INVALID_SIGNER", rejected ? `Wallet rejected ${operation}` : `Wallet could not sign ${operation}`, details, { cause });
    }
    if (deadline !== null && deadline <= this.timestamp()) throw new HunchError(deadlineCode, "Deadline elapsed during wallet authorization; nothing submitted", details);
    const signature = utils.bytes.bs58.encode(signed.signature!);
    const submitted = { ...details, signature };
    // Reconciliation needs the expiry height: after it passes, an unseen signature can never land.
    const uncertain = { ...submitted, blockhash, lastValidBlockHeight };
    try { await onSigned?.({ signature, blockhash, lastValidBlockHeight }); }
    catch (cause) { throw new HunchError("TRANSACTION_FAILED", `Could not record the signed ${operation}; nothing submitted`, { ...uncertain, stage: "pre-submission" }, { cause }); }
    try {
      const returnedSignature = await this.connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0,
      });
      if (returnedSignature !== signature) throw new Error("RPC returned a different transaction signature");
    } catch (cause) {
      // Simulation rejection is definitive. A transport failure may occur after acceptance.
      if (cause instanceof SendTransactionError && cause.message.startsWith("Simulation failed.")) {
        const reason = `${cause.transactionError.message} ${(cause.transactionError.logs ?? []).join(" ")}`;
        const programError = this.programErrorFromLogs(reason, programIndex, errors);
        const code = programError ?? (operation === "market creation" && /already in use|already exists/i.test(reason) ? "MARKET_EXISTS" : /insufficient (funds|lamports)/i.test(reason) ? "INSUFFICIENT_FUNDS" : "TRANSACTION_FAILED");
        throw new HunchError(code, `RPC preflight rejected ${operation}`, { ...submitted, stage: "preflight" }, { cause });
      }
      throw new HunchError("TRANSACTION_UNCERTAIN", "Submission response is uncertain; check the signature and PDA before retrying", { ...uncertain, stage: "submission" }, { cause });
    }
    let confirmation;
    try {
      confirmation = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    } catch (cause) {
      throw new HunchError("TRANSACTION_UNCERTAIN", "Confirmation is uncertain; check the signature and PDA before retrying", { ...uncertain, stage: "confirmation" }, { cause });
    }
    if (confirmation.value.err !== null) {
      const failed = confirmation.value.err as { InstructionError?: [number, unknown] };
      const [index, cause] = failed.InstructionError ?? [];
      const custom = index === programIndex && cause && typeof cause === "object" ? (cause as { Custom?: unknown }).Custom : undefined;
      const code = typeof custom === "number" ? errors[custom] : undefined;
      throw new HunchError(code ?? "TRANSACTION_FAILED", `${operation} failed on-chain`, { ...submitted, error: confirmation.value.err });
    }
    return { signature, slot: confirmation.context.slot };
  }

  private programErrorFromLogs(reason: string, programIndex: number, errors: Readonly<Record<number, HunchErrorCode>>): HunchErrorCode | undefined {
    const escaped = this.programId.toBase58();
    const fromLogs = reason.match(new RegExp(`Program ${escaped} failed: custom program error: 0x([0-9a-f]+)`, "i"));
    const fromMessage = reason.match(new RegExp(`Error processing Instruction ${programIndex}: custom program error: 0x([0-9a-f]+)`, "i"));
    const hex = fromLogs?.[1] ?? fromMessage?.[1];
    return hex === undefined ? undefined : errors[parseInt(hex, 16)];
  }

  private decodePosition(address: PublicKey, account: AccountInfo<Buffer>, market: Market, wallet: PublicKey, outcome: Outcome): Position {
    try {
      if (!account.owner.equals(this.programId) || account.executable || account.data.length !== this.positionSize) throw new Error("Invalid Position owner or size");
      const state = this.program.coder.accounts.decode<ChainPosition>("position", account.data);
      const expected = derivePositionPda(this.publicKey(market.id), wallet, outcome, this.programId);
      if (!expected.address.equals(address) || expected.bump !== state.bump || !state.market.equals(this.publicKey(market.id)) ||
          !state.wallet.equals(wallet) || state.outcome !== outcome) throw new Error("Position does not match its PDA seeds");
      const amount = BigInt(state.amount.toString(10));
      const payout = market.status === "resolved" && market.winningOutcome === outcome && market.pools[outcome] > 0n
        ? amount * market.totalPool / market.pools[outcome] : 0n;
      return { id: address.toBase58(), marketId: market.id, wallet: wallet.toBase58(), outcome, amount, claimed: state.claimed, payout };
    } catch (cause) {
      throw new HunchError("INVALID_RESPONSE", "Invalid on-chain Position account", { positionId: address.toBase58() }, { cause });
    }
  }

  private decodeToken(address: PublicKey, account: AccountInfo<Buffer> | null, owner: PublicKey, mint: PublicKey, allowFrozen = false) {
    try {
      const token = unpackAccount(address, account, TOKEN_PROGRAM_ID);
      if (account?.executable || !token.owner.equals(owner) || !token.mint.equals(mint) || !token.isInitialized || (token.isFrozen && !allowFrozen)) {
        throw new Error("Token account must be initialized, unfrozen, and match its owner and mint");
      }
      return token;
    } catch (cause) {
      throw new HunchError("INVALID_RESPONSE", "Invalid classic SPL token account", { tokenAccount: address.toBase58() }, { cause });
    }
  }

  async predict(params: PredictParams, signer: WalletSigner): Promise<PredictResult> {
    if (!signer || !(signer.publicKey instanceof PublicKey) || !PublicKey.isOnCurve(signer.publicKey.toBytes()) || typeof signer.signTransaction !== "function") {
      throw new HunchError("INVALID_SIGNER", "Prediction requires a connected wallet with a public key and signTransaction");
    }
    const user = new PublicKey(signer.publicKey.toBytes());
    const signTransaction = signer.signTransaction.bind(signer);
    const { outcome, amount, createAssociatedTokenAccount = false } = params;
    validateOutcome(outcome);
    if (typeof amount !== "bigint" || amount <= 0n || amount > U64_MAX) throw new HunchError("INVALID_AMOUNT", "Stake must be a positive bigint within u64 limits");
    if (typeof createAssociatedTokenAccount !== "boolean" || (params.tokenAccount !== undefined && createAssociatedTokenAccount)) {
      throw new HunchError("INVALID_INPUT", "Choose an explicit tokenAccount or ATA creation, not both");
    }
    const address = this.publicKey(params.marketId);
    const explicitToken = params.tokenAccount === undefined ? undefined : this.publicKey(params.tokenAccount);
    const positionPda = derivePositionPda(address, user, outcome, this.programId).address;
    const vault = deriveVaultPda(address, this.programId).address;
    const details = { marketId: address.toBase58(), positionId: positionPda.toBase58(), vault: vault.toBase58(), outcome, amount: amount.toString() };
    let market: Market, previousPosition: Position | null, previousVaultBalance: bigint;
    let tokenAccount: PublicKey, source: PublicKey | undefined, decimals: number;
    let vaultMissing: boolean, positionMissing: boolean, ataMissing = false;
    try {
      if (await this.connection.getGenesisHash() !== HUNCH_DEVNET_GENESIS_HASH) throw new HunchError("CONFIGURATION_ERROR", "Predictions are restricted to Solana Devnet", details);
      const marketAccount = await this.connection.getAccountInfo(address, "confirmed");
      if (!marketAccount) throw new HunchError("MARKET_NOT_FOUND", "Market PDA does not exist", details);
      market = this.decode(address, marketAccount, this.timestamp());
      if (market.status !== "open") throw new HunchError(market.status === "resolved" ? "MARKET_RESOLVED" : "MARKET_CLOSED", "Market is not open for predictions", details);
      if (market.tokenMint !== this.mint.toBase58()) throw new HunchError("CONFIGURATION_ERROR", "Market mint differs from the configured Devnet mint", details);
      const ata = getAssociatedTokenAddressSync(this.mint, user);
      const [programAccount, mintAccount, vaultAccount, positionAccount, userAccount] = await this.connection.getMultipleAccountsInfo(
        [this.programId, this.mint, vault, positionPda, explicitToken ?? ata], "confirmed");
      if (!programAccount?.executable) throw new HunchError("CONFIGURATION_ERROR", "Configured program is not deployed", details);
      try {
        const mint = unpackMint(this.mint, mintAccount, TOKEN_PROGRAM_ID);
        if (!mint.isInitialized || mintAccount?.executable) throw new Error("Uninitialized mint");
        decimals = mint.decimals;
      } catch (cause) { throw new HunchError("CONFIGURATION_ERROR", "Prediction requires an initialized classic SPL mint", details, { cause }); }
      vaultMissing = vaultAccount === null;
      positionMissing = positionAccount === null;
      previousVaultBalance = vaultAccount ? this.decodeToken(vault, vaultAccount, address, this.mint).amount : 0n;
      previousPosition = positionAccount ? this.decodePosition(positionPda, positionAccount, market, user, outcome) : null;
      if (previousPosition?.claimed) throw new HunchError("INVALID_RESPONSE", "An active market cannot contain an already claimed position", details);
      if ((previousPosition?.amount ?? 0n) + amount > U64_MAX || market.totalPool + amount > U64_MAX || previousVaultBalance + amount > U64_MAX) {
        throw new HunchError("INVALID_AMOUNT", "Stake would overflow an accumulated position, pool, or vault", details);
      }
      tokenAccount = explicitToken ?? ata;
      if (userAccount) {
        const token = this.decodeToken(tokenAccount, userAccount, user, this.mint);
        if (token.amount < amount) throw new HunchError("INSUFFICIENT_FUNDS", "Wallet token account has insufficient TEST base units", { ...details, tokenAccount: tokenAccount.toBase58(), available: token.amount.toString() });
      } else {
        if (explicitToken) throw new HunchError("INVALID_INPUT", "Explicit token account does not exist", details);
        // A new ATA has no tokens. Select a funded wallet-owned source, never mint.
        const owned = await this.connection.getTokenAccountsByOwner(user, { mint: this.mint }, "confirmed");
        const candidates = owned.value.map(({ pubkey, account }) => ({ pubkey, token: this.decodeToken(pubkey, account, user, this.mint, true) }))
          .filter(({ token }) => !token.isFrozen && token.amount >= amount).sort((a, b) => a.pubkey.toBase58().localeCompare(b.pubkey.toBase58()));
        if (!candidates.length) throw new HunchError("INSUFFICIENT_FUNDS", "No wallet-owned TEST account has enough tokens; obtain TEST from its mint authority or a funded holder", details);
        if (createAssociatedTokenAccount) { ataMissing = true; source = candidates[0].pubkey; }
        else tokenAccount = candidates[0].pubkey;
      }
    } catch (cause) {
      if (cause instanceof HunchError) throw cause;
      throw new HunchError("NETWORK_ERROR", "Devnet prediction preflight failed", details, { cause });
    }
    let transaction: Transaction;
    try {
      const instruction = await this.program.methods.placePrediction(outcome, new BN(amount.toString()))
        .accountsStrict({ user, market: address, tokenMint: this.mint, vault, userTokenAccount: tokenAccount, position: positionPda,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction();
      const latest = await this.connection.getLatestBlockhash("confirmed");
      transaction = new Transaction({ feePayer: user, ...latest });
      if (ataMissing) {
        transaction.add(createAssociatedTokenAccountIdempotentInstruction(user, tokenAccount, user, this.mint));
        transaction.add(createTransferCheckedInstruction(source!, this.mint, tokenAccount, user, amount, decimals));
      }
      transaction.add(instruction);
      const sizes = [...(vaultMissing ? [ACCOUNT_SIZE] : []), ...(positionMissing ? [this.positionSize] : []), ...(ataMissing ? [ACCOUNT_SIZE] : [])];
      const [rents, fee, balance] = await Promise.all([
        Promise.all(sizes.map(size => this.connection.getMinimumBalanceForRentExemption(size, "confirmed"))),
        this.connection.getFeeForMessage(transaction.compileMessage(), "confirmed"), this.connection.getBalance(user, "confirmed"),
      ]);
      if (fee.value === null) throw new HunchError("NETWORK_ERROR", "RPC could not estimate the transaction fee", details);
      const requiredLamports = rents.reduce((sum, rent) => sum + rent, 0) + fee.value;
      if (balance < requiredLamports) throw new HunchError("INSUFFICIENT_FUNDS", "Wallet needs Devnet SOL for new accounts and transaction fees", { ...details, requiredLamports, balanceLamports: balance });
    } catch (cause) {
      if (cause instanceof HunchError) throw cause;
      throw new HunchError("NETWORK_ERROR", "Could not prepare the prediction transaction", details, { cause });
    }
    const { signature, slot } = await this.authorizeAndSubmit(transaction, signTransaction, market.closesAt, details, "prediction");
    try {
      // One bank snapshot, at least as recent as confirmation, avoids stale mixed reads.
      const [marketAccount, positionAccount, vaultAccount] = await this.connection.getMultipleAccountsInfo([address, positionPda, vault], { commitment: "confirmed", minContextSlot: slot });
      if (!marketAccount || !positionAccount || !vaultAccount) throw new Error("Confirmed stake accounts are missing");
      const updatedMarket = this.decode(address, marketAccount, this.timestamp());
      if (updatedMarket.authority !== market.authority || updatedMarket.tokenMint !== market.tokenMint || updatedMarket.resolverAuthority !== market.resolverAuthority || updatedMarket.closesAt !== market.closesAt) throw new Error("Market configuration changed");
      const position = this.decodePosition(positionPda, positionAccount, updatedMarket, user, outcome);
      const vaultBalance = this.decodeToken(vault, vaultAccount, address, this.mint).amount;
      // Other wallets may stake between snapshots; require at least our contribution.
      if (position.amount < (previousPosition?.amount ?? 0n) + amount || updatedMarket.pools[outcome] < market.pools[outcome] + amount || vaultBalance < previousVaultBalance + amount) {
        throw new Error("Confirmed state does not contain the requested stake");
      }
      return { position, verification: { market: updatedMarket, vault: vault.toBase58(), vaultBalance, tokenAccount: tokenAccount.toBase58() },
        signature, transaction: { mode: "anchor", id: signature, signature, status: "confirmed" } };
    } catch (cause) {
      throw new HunchError("INVALID_RESPONSE", "Transaction confirmed, but stake verification failed; check the signature before staking again", { ...details, signature, stage: "verification", confirmationStatus: "confirmed" }, { cause });
    }
  }

  async getPositions(marketId: string, wallet?: string): Promise<Position[]> {
    if (wallet === undefined) throw new HunchError("WALLET_REQUIRED", "Anchor position reads require a public wallet address; no signature is needed");
    const address = this.publicKey(marketId), user = this.publicKey(wallet);
    const pdas = ([0, 1] as const).map(outcome => derivePositionPda(address, user, outcome, this.programId).address);
    let accounts;
    try { accounts = await this.connection.getMultipleAccountsInfo([address, ...pdas], "confirmed"); }
    catch (cause) { throw new HunchError("NETWORK_ERROR", "Failed to read on-chain positions", undefined, { cause }); }
    if (!accounts[0]) throw new HunchError("MARKET_NOT_FOUND", "Market PDA does not exist", { marketId });
    const market = this.decode(address, accounts[0], this.timestamp());
    return ([0, 1] as const).flatMap(outcome => {
      const account = accounts[outcome + 1];
      return account ? [this.decodePosition(pdas[outcome], account, market, user, outcome)] : [];
    });
  }

  async claimWinnings(marketId: string, signer: WalletSigner, options: ClaimOptions = {}): Promise<ClaimResult> {
    if (!signer || !(signer.publicKey instanceof PublicKey) || !PublicKey.isOnCurve(signer.publicKey.toBytes()) || typeof signer.signTransaction !== "function") {
      throw new HunchError("INVALID_SIGNER", "Claiming requires a connected wallet with a public key and signTransaction");
    }
    const user = new PublicKey(signer.publicKey.toBytes());
    const signTransaction = signer.signTransaction.bind(signer);
    const { createAssociatedTokenAccount = false } = options ?? {};
    if (typeof createAssociatedTokenAccount !== "boolean" || (options?.tokenAccount !== undefined && createAssociatedTokenAccount)) {
      throw new HunchError("INVALID_INPUT", "Choose an explicit tokenAccount or ATA creation, not both");
    }
    const address = this.publicKey(marketId);
    const explicitToken = options?.tokenAccount === undefined ? undefined : this.publicKey(options.tokenAccount);
    const vault = deriveVaultPda(address, this.programId).address;
    const ata = getAssociatedTokenAddressSync(this.mint, user);
    let details: Record<string, unknown> = { marketId: address.toBase58(), vault: vault.toBase58() };
    let market: Market, position: Position, positionPda: PublicKey, payout: bigint, previousVaultBalance: bigint;
    let tokenAccount: PublicKey, previousTokenBalance: bigint, ataMissing = false;
    try {
      if (await this.connection.getGenesisHash() !== HUNCH_DEVNET_GENESIS_HASH) throw new HunchError("CONFIGURATION_ERROR", "Claims are restricted to Solana Devnet", details);
      const marketAccount = await this.connection.getAccountInfo(address, "confirmed");
      if (!marketAccount) throw new HunchError("MARKET_NOT_FOUND", "Market PDA does not exist", details);
      market = this.decode(address, marketAccount, this.timestamp());
      if (market.status !== "resolved" || market.winningOutcome === null) {
        throw new HunchError("MARKET_NOT_RESOLVED", market.status === "cancelled" ? "Market was cancelled; refunds are not supported by the contract" : "Market has not been resolved", details);
      }
      if (market.tokenMint !== this.mint.toBase58()) throw new HunchError("CONFIGURATION_ERROR", "Market mint differs from the configured Devnet mint", details);
      const winning = market.winningOutcome;
      positionPda = derivePositionPda(address, user, winning, this.programId).address;
      const losingPda = derivePositionPda(address, user, winning === 0 ? 1 : 0, this.programId).address;
      details = { ...details, positionId: positionPda.toBase58(), winningOutcome: winning };
      const [programAccount, mintAccount, vaultAccount, positionAccount, losingAccount, recipientAccount] = await this.connection.getMultipleAccountsInfo(
        [this.programId, this.mint, vault, positionPda, losingPda, explicitToken ?? ata], "confirmed");
      if (!programAccount?.executable) throw new HunchError("CONFIGURATION_ERROR", "Configured program is not deployed", details);
      try {
        const mint = unpackMint(this.mint, mintAccount, TOKEN_PROGRAM_ID);
        if (!mint.isInitialized || mintAccount?.executable) throw new Error("Uninitialized mint");
      } catch (cause) { throw new HunchError("CONFIGURATION_ERROR", "Claims require an initialized classic SPL mint", details, { cause }); }
      if (!positionAccount) {
        throw new HunchError("NO_WINNING_POSITION", losingAccount ? "Wallet only backed the losing outcome" : "Wallet has no position on the winning outcome", details);
      }
      position = this.decodePosition(positionPda, positionAccount, market, user, winning);
      if (position.claimed) throw new HunchError("ALREADY_CLAIMED", "This winning position was already claimed", details);
      if (!vaultAccount) throw new HunchError("INVALID_RESPONSE", "Market vault is missing although a winning position exists", details);
      previousVaultBalance = this.decodeToken(vault, vaultAccount, address, this.mint).amount;
      payout = computeClaimPayout(position.amount, market.pools, winning);
      details = { ...details, expectedPayout: payout.toString() };
      if (previousVaultBalance < payout) throw new HunchError("INVALID_RESPONSE", "Vault holds fewer tokens than the expected payout", { ...details, vaultBalance: previousVaultBalance.toString() });
      if (recipientAccount) {
        tokenAccount = explicitToken ?? ata;
        previousTokenBalance = this.decodeToken(tokenAccount, recipientAccount, user, this.mint).amount;
      } else if (explicitToken) {
        throw new HunchError("INVALID_INPUT", "Explicit token account does not exist", details);
      } else if (createAssociatedTokenAccount) {
        ataMissing = true; tokenAccount = ata; previousTokenBalance = 0n;
      } else {
        // The ATA is absent: pay a deterministic existing, usable wallet-owned account of this mint.
        const owned = await this.connection.getTokenAccountsByOwner(user, { mint: this.mint }, "confirmed");
        const candidates = owned.value.map(({ pubkey, account }) => ({ pubkey, token: this.decodeToken(pubkey, account, user, this.mint, true) }))
          .filter(({ token }) => !token.isFrozen).sort((a, b) => a.pubkey.toBase58().localeCompare(b.pubkey.toBase58()));
        if (!candidates.length) throw new HunchError("INVALID_INPUT", "Wallet has no usable token account for this mint; pass createAssociatedTokenAccount: true", details);
        tokenAccount = candidates[0].pubkey; previousTokenBalance = candidates[0].token.amount;
      }
      if (previousTokenBalance + payout > U64_MAX) throw new HunchError("INVALID_AMOUNT", "Payout would overflow the recipient token account", details);
      details = { ...details, tokenAccount: tokenAccount.toBase58() };
    } catch (cause) {
      if (cause instanceof HunchError) throw cause;
      throw new HunchError("NETWORK_ERROR", "Devnet claim preflight failed", details, { cause });
    }
    let transaction: Transaction;
    try {
      const instruction = await this.program.methods.claimWinnings()
        .accountsStrict({ user, market: address, tokenMint: this.mint, vault, position: positionPda,
          userTokenAccount: tokenAccount, tokenProgram: TOKEN_PROGRAM_ID }).instruction();
      const latest = await this.connection.getLatestBlockhash("confirmed");
      transaction = new Transaction({ feePayer: user, ...latest });
      if (ataMissing) transaction.add(createAssociatedTokenAccountIdempotentInstruction(user, tokenAccount, user, this.mint));
      transaction.add(instruction);
      const [rent, fee, balance] = await Promise.all([
        ataMissing ? this.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "confirmed") : Promise.resolve(0),
        this.connection.getFeeForMessage(transaction.compileMessage(), "confirmed"), this.connection.getBalance(user, "confirmed"),
      ]);
      if (fee.value === null) throw new HunchError("NETWORK_ERROR", "RPC could not estimate the transaction fee", details);
      if (balance < rent + fee.value) throw new HunchError("INSUFFICIENT_FUNDS", "Wallet needs Devnet SOL for transaction fees and any new token account", { ...details, requiredLamports: rent + fee.value, balanceLamports: balance });
    } catch (cause) {
      if (cause instanceof HunchError) throw cause;
      throw new HunchError("NETWORK_ERROR", "Could not prepare the claim transaction", details, { cause });
    }
    const { signature, slot } = await this.authorizeAndSubmit(transaction, signTransaction, null, details, "claim");
    try {
      const [marketAccount, positionAccount, vaultAccount, recipientAccount] = await this.connection.getMultipleAccountsInfo(
        [address, positionPda, vault, tokenAccount], { commitment: "confirmed", minContextSlot: slot });
      if (!marketAccount || !positionAccount || !vaultAccount || !recipientAccount) throw new Error("Claim accounts are missing after confirmation");
      const updatedMarket = this.decode(address, marketAccount, this.timestamp());
      if (updatedMarket.status !== "resolved" || updatedMarket.winningOutcome !== market.winningOutcome) throw new Error("Market resolution changed");
      const claimed = this.decodePosition(positionPda, positionAccount, updatedMarket, user, market.winningOutcome!);
      if (!claimed.claimed || claimed.amount !== position.amount) throw new Error("Position is not recorded as claimed");
      const vaultBalance = this.decodeToken(vault, vaultAccount, address, this.mint).amount;
      const tokenBalance = this.decodeToken(tokenAccount, recipientAccount, user, this.mint).amount;
      // Current balances can include concurrent transfers; this transaction's own token
      // balance metadata gives the exact movement it caused.
      const deltas = await this.tokenDeltas(signature, [vault, tokenAccount]);
      if (deltas[0] !== -payout || deltas[1] !== payout) throw new Error(`Transaction moved ${deltas[1]} instead of ${payout}`);
      return {
        payout, position: claimed, signature, transaction: { mode: "anchor", id: signature, signature, status: "confirmed" },
        verification: { vault: vault.toBase58(), vaultBalance, tokenAccount: tokenAccount.toBase58(), tokenBalance, tokenAccountCreated: ataMissing },
      };
    } catch (cause) {
      throw new HunchError("INVALID_RESPONSE", "Transaction confirmed, but claim verification failed; check the signature before claiming again",
        { ...details, signature, stage: "verification", confirmationStatus: "confirmed" }, { cause });
    }
  }

  /** Exact per-account token deltas for one confirmed transaction, from its own metadata. */
  private async tokenDeltas(signature: string, accounts: PublicKey[]): Promise<bigint[]> {
    let response = null;
    for (let attempt = 0; attempt < METADATA_ATTEMPTS && !response; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, METADATA_DELAY_MS));
      // Reads are safe to repeat; RPC nodes can briefly lag behind confirmation.
      response = await this.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    }
    if (!response?.meta) throw new Error("Transaction metadata is unavailable");
    if (response.meta.err !== null) throw new Error("Transaction metadata reports an error");
    const meta = response.meta;
    const keys = (response.transaction.message as MessageV0).getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses ?? undefined });
    const amount = (balances: typeof meta.preTokenBalances, account: PublicKey) => {
      const entry = (balances ?? []).find(item => keys.get(item.accountIndex)?.equals(account) && item.mint === this.mint.toBase58());
      return entry ? BigInt(entry.uiTokenAmount.amount) : 0n;
    };
    return accounts.map(account => amount(meta.postTokenBalances, account) - amount(meta.preTokenBalances, account));
  }

  /** Read-only signature lookup, including history, for reconciling uncertain submissions. */
  async getTransactionStatus(id: string): Promise<TransactionStatusResult> {
    let bytes: Uint8Array | undefined;
    try { bytes = utils.bytes.bs58.decode(id); } catch { bytes = undefined; }
    if (typeof id !== "string" || bytes?.length !== 64) throw new HunchError("INVALID_INPUT", "Expected a base58 transaction signature");
    let status;
    try { status = (await this.connection.getSignatureStatuses([id], { searchTransactionHistory: true })).value[0]; }
    catch (cause) { throw new HunchError("NETWORK_ERROR", "Failed to read the transaction status", { signature: id }, { cause }); }
    const result = { mode: "anchor" as const, id, signature: id };
    if (!status) return { ...result, status: "not_found" };
    if (status.err !== null) return { ...result, status: "failed", error: JSON.stringify(status.err) };
    return { ...result, status: status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" ? "confirmed" : "submitted" };
  }

  /**
   * Trusted server only. Signs the contract's resolve_market with the market's resolver key.
   * The deployed program does not check the deadline, so it is enforced here against both the
   * local clock and the cluster Clock sysvar before any signature is requested.
   */
  async resolveMarket(marketId: string, outcome: Outcome, signer: WalletSigner, options: ResolveOptions = {}): Promise<TransactionResult> {
    if (typeof (globalThis as { document?: unknown }).document !== "undefined") {
      throw new HunchError("UNAUTHORIZED", "Market resolution is a trusted-server operation and is disabled in browsers");
    }
    if (!signer || !(signer.publicKey instanceof PublicKey) || !PublicKey.isOnCurve(signer.publicKey.toBytes()) || typeof signer.signTransaction !== "function") {
      throw new HunchError("INVALID_SIGNER", "Resolution requires the resolver's server-side signer");
    }
    validateOutcome(outcome);
    const resolver = new PublicKey(signer.publicKey.toBytes());
    const signTransaction = signer.signTransaction.bind(signer);
    const address = this.publicKey(marketId);
    const details = { marketId: address.toBase58(), outcome, resolver: resolver.toBase58() };
    if (!resolver.equals(this.resolver)) {
      throw new HunchError("UNAUTHORIZED", "Signer is not the configured resolver authority; prediction wallets cannot resolve markets", { ...details, expectedResolver: this.resolver.toBase58() });
    }
    let market: Market;
    try {
      if (await this.connection.getGenesisHash() !== HUNCH_DEVNET_GENESIS_HASH) throw new HunchError("CONFIGURATION_ERROR", "Resolution is restricted to Solana Devnet", details);
      const [marketAccount, programAccount, clockAccount] = await this.connection.getMultipleAccountsInfo([address, this.programId, SYSVAR_CLOCK_PUBKEY], "confirmed");
      if (!programAccount?.executable) throw new HunchError("CONFIGURATION_ERROR", "Configured program is not deployed", details);
      if (!marketAccount) throw new HunchError("MARKET_NOT_FOUND", "Market PDA does not exist", details);
      market = this.decode(address, marketAccount, this.timestamp());
      // Creation is permissionless: only settle markets escrowing the approved mint.
      if (market.tokenMint !== this.mint.toBase58()) throw new HunchError("CONFIGURATION_ERROR", "Market mint differs from the approved mint; refusing to resolve", { ...details, tokenMint: market.tokenMint });
      if (market.resolverAuthority !== resolver.toBase58()) throw new HunchError("UNAUTHORIZED", "Market names a different resolver authority", { ...details, marketResolver: market.resolverAuthority });
      if (market.status === "resolved") throw new HunchError("MARKET_RESOLVED", "Market is already resolved", { ...details, winningOutcome: market.winningOutcome });
      if (market.status === "cancelled") throw new HunchError("MARKET_CLOSED", "Market was cancelled and cannot be resolved", details);
      if (market.status === "open") throw new HunchError("MARKET_NOT_CLOSED", "Resolution requires the market deadline to pass", { ...details, closesAt: market.closesAt });
      // The local clock may run ahead of the cluster; the contract fix compares Clock::unix_timestamp.
      const chainTime = this.clusterTime(clockAccount);
      if (chainTime < market.closesAt) throw new HunchError("MARKET_NOT_CLOSED", "Cluster clock has not reached the market deadline", { ...details, closesAt: market.closesAt, clusterTime: chainTime });
    } catch (cause) {
      if (cause instanceof HunchError) throw cause;
      throw new HunchError("NETWORK_ERROR", "Devnet resolution preflight failed", details, { cause });
    }
    let transaction: Transaction;
    try {
      const instruction = await this.program.methods.resolveMarket(outcome).accountsStrict({ resolver, market: address }).instruction();
      transaction = new Transaction({ feePayer: resolver, ...await this.connection.getLatestBlockhash("confirmed") }).add(instruction);
      const [fee, balance] = await Promise.all([
        this.connection.getFeeForMessage(transaction.compileMessage(), "confirmed"), this.connection.getBalance(resolver, "confirmed"),
      ]);
      if (fee.value === null) throw new HunchError("NETWORK_ERROR", "RPC could not estimate the transaction fee", details);
      if (balance < fee.value) throw new HunchError("INSUFFICIENT_FUNDS", "Resolver needs Devnet SOL for the transaction fee", { ...details, requiredLamports: fee.value, balanceLamports: balance });
    } catch (cause) {
      if (cause instanceof HunchError) throw cause;
      throw new HunchError("NETWORK_ERROR", "Could not prepare the resolution transaction", details, { cause });
    }
    if (options?.onSigned !== undefined && typeof options.onSigned !== "function") throw new HunchError("INVALID_INPUT", "onSigned must be a function", details);
    const { signature, slot } = await this.authorizeAndSubmit(transaction, signTransaction, null, details, "resolution", options?.onSigned);
    try {
      const [account] = await this.connection.getMultipleAccountsInfo([address], { commitment: "confirmed", minContextSlot: slot });
      if (!account) throw new Error("Market is missing after confirmation");
      const resolved = this.decode(address, account, this.timestamp());
      if (resolved.status !== "resolved" || resolved.winningOutcome !== outcome) throw new Error("Market does not record the requested winning outcome");
      if (resolved.authority !== market.authority || resolved.resolverAuthority !== market.resolverAuthority || resolved.tokenMint !== market.tokenMint ||
          resolved.closesAt !== market.closesAt || resolved.pools[0] !== market.pools[0] || resolved.pools[1] !== market.pools[1]) throw new Error("Market configuration changed");
      return { mode: "anchor", id: signature, signature, status: "confirmed" };
    } catch (cause) {
      throw new HunchError("INVALID_RESPONSE", "Transaction confirmed, but resolved market verification failed; reconcile before any retry",
        { ...details, signature, stage: "verification", confirmationStatus: "confirmed" }, { cause });
    }
  }

  private clusterTime(account: AccountInfo<Buffer> | null): number {
    // Clock sysvar: slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64.
    if (!account || account.owner.toBase58() !== SYSVAR_OWNER || account.data.length < 40) throw new HunchError("INVALID_RESPONSE", "Clock sysvar is unavailable or malformed");
    const time = Buffer.from(account.data).readBigInt64LE(32);
    if (time > BigInt(Number.MAX_SAFE_INTEGER) || time < 0n) throw new HunchError("INVALID_RESPONSE", "Clock sysvar time is out of range");
    return Number(time);
  }
}

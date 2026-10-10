import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export type Outcome = 0 | 1;
export type MarketStatus = "open" | "closed" | "resolved" | "cancelled";
export type AdapterMode = "mock" | "anchor";
export type TransactionStatus = "submitted" | "confirmed" | "failed" | "not_found";

/** Authoritative state, separate from labels and application metadata. */
export interface MarketState {
  /** Market PDA base58 address in Anchor mode; off-chain identifier in mock mode. */
  id: string;
  authority: string;
  resolverAuthority: string;
  tokenMint: string | null;
  /** Original 32-byte seed, present for on-chain markets. Not a private key. */
  marketSeed?: Uint8Array;
  closesAt: number;
  status: MarketStatus;
  totalPool: bigint;
  pools: [bigint, bigint];
  winningOutcome: Outcome | null;
}

export interface MarketMetadata {
  question: string;
  outcomes: [string, string];
  description?: string;
}

export interface Market extends MarketState {
  metadata: MarketMetadata | null;
  /** Compatibility aliases for the original MarketKit interface. */
  question?: string;
  outcomes?: [string, string];
}

export interface Prediction {
  marketId: string;
  wallet: string;
  outcome: Outcome;
  amount: bigint;
}

export interface Position extends Prediction {
  /** Position PDA in Anchor mode. */
  id?: string;
  claimed: boolean;
  payout: bigint;
}

/** Compatible with Solana wallet-adapter. The SDK never stores a private key. */
export interface WalletSigner {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
}

export type TransactionResult =
  | { mode: "mock"; id: string; signature: null; status: "confirmed" }
  | { mode: "anchor"; id: string; signature: string; status: "submitted" | "confirmed" | "failed" };

export interface TransactionStatusResult {
  mode: AdapterMode;
  id: string;
  signature: string | null;
  status: TransactionStatus;
  error?: string;
}

export interface CreateMarketParams {
  /** Mock ID. In Anchor mode, if provided, must equal the derived Market PDA. */
  id?: string;
  /** Anchor seed. Omit to generate securely; save it before submitting for reproducibility. */
  marketSeed?: Uint8Array;
  question: string;
  outcomes: [string, string];
  closesAt: number;
  resolverAuthority?: string;
  description?: string;
}

export interface PredictParams {
  marketId: string;
  outcome: Outcome;
  /** Integer token base units; Anchor validates the u64 range. */
  amount: bigint;
  /** Anchor only: explicit classic SPL token account owned by the signing wallet. */
  tokenAccount?: string;
  /** Anchor only: create a missing ATA and fund it from an existing owned account atomically. */
  createAssociatedTokenAccount?: boolean;
}

export interface ListMarketsParams {
  authority?: string;
  status?: MarketStatus;
}

export interface CreateMarketResult {
  market: Market;
  transaction: TransactionResult;
  signature: string | null;
  /** Seed used for Anchor creation; mock adapters do not return this field. */
  marketSeed?: Uint8Array;
}
export interface PredictResult {
  /** Confirmed aggregate position, including prior stakes on this outcome. */
  position: Position;
  /** Anchor post-confirmation state from one RPC snapshot. */
  verification?: { market: Market; vault: string; vaultBalance: bigint; tokenAccount: string };
  transaction: TransactionResult;
  signature: string | null;
}
/** Anchor only: choose where winnings are paid. Mock/HTTP adapters ignore these. */
export interface ClaimOptions {
  /** Explicit classic SPL token account owned by the claiming wallet. */
  tokenAccount?: string;
  /** Create the wallet's missing ATA in the same transaction and pay it the winnings. */
  createAssociatedTokenAccount?: boolean;
}

export interface ClaimResult {
  payout: bigint;
  transaction: TransactionResult;
  signature: string | null;
  /** Anchor: the claimed on-chain position after confirmation. */
  position?: Position;
  /** Anchor: post-confirmation balances; deltas come from this transaction's own metadata. */
  verification?: {
    vault: string; vaultBalance: bigint;
    tokenAccount: string; tokenBalance: bigint; tokenAccountCreated: boolean;
  };
}

/** Signed but not yet broadcast; persist this before submission to reconcile later. */
export interface SignedSubmission { signature: string; blockhash: string; lastValidBlockHeight: number }
export interface ResolveOptions {
  /** Anchor only: awaited after signing and before broadcast. A throw aborts with nothing sent. */
  onSigned?: (submission: SignedSubmission) => void | Promise<void>;
}

/** The same interface is used in mock and real modes. */
export interface MarketAdapter {
  readonly mode: AdapterMode;
  createMarket(params: CreateMarketParams, signer: WalletSigner): Promise<CreateMarketResult>;
  getMarket(marketId: string): Promise<Market | null>;
  listMarkets(params?: ListMarketsParams): Promise<Market[]>;
  predict(params: PredictParams, signer: WalletSigner): Promise<PredictResult>;
  getPositions(marketId: string, wallet?: string): Promise<Position[]>;
  claimWinnings(marketId: string, signer: WalletSigner, options?: ClaimOptions): Promise<ClaimResult>;
  getTransactionStatus(id: string): Promise<TransactionStatusResult>;
  /** Trusted backend only. Implementations must enforce resolver authority. */
  resolveMarket(marketId: string, outcome: Outcome, signer: WalletSigner, options?: ResolveOptions): Promise<TransactionResult>;
}

export interface HunchConfig {
  adapter?: MarketAdapter;
  mode?: AdapterMode;
  wallet?: WalletSigner;
  rpcUrl?: string;
  /** Optional Anchor RPC connection; takes precedence over rpcUrl. Reads use confirmed commitment. */
  connection?: Connection;
  programId?: string;
  /** Anchor creation mint. Defaults to Hunch's approved Devnet test mint. */
  tokenMint?: string;
  resolverAuthority?: string;
  authorizedCreators?: readonly string[];
  clock?: () => number;
  /** Legacy flag. false always selects real mode and never falls back. */
  mock?: boolean;
}

export interface GameEventPayload {
  appId: string;
  eventId: string;
  marketId: string;
  outcome: Outcome;
  timestamp: number;
}
export interface SignedGameEvent extends GameEventPayload {
  signature: string;
}
export type GameResultEvent = SignedGameEvent;

export type HunchErrorCode =
  | "INVALID_INPUT" | "INVALID_OUTCOME" | "INVALID_AMOUNT" | "INVALID_DEADLINE"
  | "MARKET_NOT_FOUND" | "MARKET_EXISTS" | "MARKET_CLOSED" | "MARKET_NOT_CLOSED"
  | "MARKET_RESOLVED" | "MARKET_NOT_RESOLVED" | "UNAUTHORIZED" | "NO_WINNING_POSITION"
  | "ALREADY_CLAIMED" | "WALLET_REQUIRED" | "CONFIGURATION_ERROR"
  | "CONTRACT_UNAVAILABLE" | "TRANSACTION_FAILED" | "TRANSACTION_UNCERTAIN"
  | "HTTP_ERROR" | "NETWORK_ERROR" | "INVALID_RESPONSE"
  | "USER_REJECTED" | "INVALID_SIGNER" | "INSUFFICIENT_FUNDS";

export class HunchError extends Error {
  readonly name = "HunchError";
  constructor(
    readonly code: HunchErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

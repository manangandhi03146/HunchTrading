import type { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export type Outcome = 0 | 1;
export type MarketStatus = "open" | "closed" | "resolved" | "cancelled";
export type AdapterMode = "mock" | "anchor";
export type TransactionStatus = "submitted" | "confirmed" | "failed" | "not_found";

/** Authoritative state, separate from labels and application metadata. */
export interface MarketState {
  id: string;
  authority: string;
  resolverAuthority: string;
  tokenMint: string | null;
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
  /** Off-chain ID; its on-chain encoding must be supplied by Developer A. */
  id?: string;
  question: string;
  outcomes: [string, string];
  closesAt: number;
  resolverAuthority?: string;
  description?: string;
}

export interface PredictParams {
  marketId: string;
  outcome: Outcome;
  amount: bigint;
}

export interface ListMarketsParams {
  authority?: string;
  status?: MarketStatus;
}

export interface CreateMarketResult {
  market: Market;
  transaction: TransactionResult;
  signature: string | null;
}
export interface PredictResult {
  position: Position;
  transaction: TransactionResult;
  signature: string | null;
}
export interface ClaimResult {
  payout: bigint;
  transaction: TransactionResult;
  signature: string | null;
}

/** The same interface is used in mock and real modes. */
export interface MarketAdapter {
  readonly mode: AdapterMode;
  createMarket(params: CreateMarketParams, signer: WalletSigner): Promise<CreateMarketResult>;
  getMarket(marketId: string): Promise<Market | null>;
  listMarkets(params?: ListMarketsParams): Promise<Market[]>;
  predict(params: PredictParams, signer: WalletSigner): Promise<PredictResult>;
  getPositions(marketId: string, wallet?: string): Promise<Position[]>;
  claimWinnings(marketId: string, signer: WalletSigner): Promise<ClaimResult>;
  getTransactionStatus(id: string): Promise<TransactionStatusResult>;
  /** Trusted backend only. Implementations must enforce resolver authority. */
  resolveMarket(marketId: string, outcome: Outcome, signer: WalletSigner): Promise<TransactionResult>;
}

export interface HunchConfig {
  adapter?: MarketAdapter;
  mode?: AdapterMode;
  wallet?: WalletSigner;
  rpcUrl?: string;
  programId?: string;
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
  | "HTTP_ERROR" | "NETWORK_ERROR" | "INVALID_RESPONSE";

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

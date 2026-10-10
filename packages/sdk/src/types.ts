/**
 * hunch shared types — the agreed contract interface (plan §2).
 *
 * `MarketStatus` is an SDK-DERIVED view of on-chain state. The contract does
 * NOT store four separate states: `open`/`closed` are derived from the
 * deadline; only `resolved` and `cancelled` are final recorded on-chain states.
 */
export type MarketStatus = "open" | "closed" | "resolved" | "cancelled";

/** Binary market: outcome 0 or 1. */
export type Outcome = 0 | 1;

export interface Market {
  /** Fixed-size unique id (e.g. 32-byte value), not an unbounded string. */
  id: string;
  /** Off-chain metadata. */
  question: string;
  /** Off-chain metadata: labels for [outcome0, outcome1]. */
  outcomes: [string, string];
  /** Unix seconds. Past this, the market is `closed` (derived). */
  closesAt: number;
  status: MarketStatus;
  /** Token base units (zero-decimal mint => integer amounts). */
  totalPool: bigint;
  /** Staked per outcome: [pool0, pool1]. */
  pools: [bigint, bigint];
  /** Set only once resolved. */
  winningOutcome: Outcome | null;
}

/**
 * One accumulated position per (wallet, outcome). A wallet may stake on both
 * outcomes, but each wallet/outcome combo collapses into a single position.
 */
export interface Prediction {
  marketId: string;
  wallet: string;
  outcome: Outcome;
  amount: bigint;
}

/** Signed event payload posted by a developer's game server to the resolver. */
export interface GameResultEvent {
  /** Unique id used for replay protection (stored by the backend). */
  eventId: string;
  marketId: string;
  winningOutcome: Outcome;
  /** Authoritative server timestamp (unix seconds). */
  timestamp: number;
  /** base58/base64 signature over the canonical payload. */
  signature: string;
  /** Developer app's registered public key that produced the signature. */
  publicKey: string;
}

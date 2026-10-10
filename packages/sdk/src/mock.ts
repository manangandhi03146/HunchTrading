import type { PublicKey } from "@solana/web3.js";
import { HunchError } from "./types.js";
import type {
  Market, Position, WalletSigner, MarketAdapter, CreateMarketParams, PredictParams,
  ListMarketsParams, TransactionResult, TransactionStatusResult,
  CreateMarketResult, PredictResult, ClaimResult, Outcome,
} from "./types.js";

export interface MockAdapterConfig {
  resolverAuthority: string;
  authorizedCreators: readonly string[];
  /** Unix seconds; injectable for deterministic tests and demos. */
  clock?: () => number;
}

/** Identity-only wallet for mock mode. It cannot sign a blockchain transaction. */
export function createMockWallet(publicKey: PublicKey): WalletSigner {
  return {
    publicKey,
    async signTransaction() {
      throw new HunchError("CONFIGURATION_ERROR", "Mock wallets cannot sign Solana transactions");
    },
  };
}

function assertOutcome(outcome: unknown): asserts outcome is Outcome {
  if (outcome !== 0 && outcome !== 1) throw new HunchError("INVALID_OUTCOME", "Outcome must be 0 or 1");
}

export class MockMarketAdapter implements MarketAdapter {
  readonly mode = "mock" as const;
  private readonly markets = new Map<string, Market>();
  private readonly positions = new Map<string, Position>();
  private readonly transactions = new Map<string, TransactionResult>();
  private marketSequence = 0;
  private transactionSequence = 0;
  private readonly now: () => number;
  private readonly creators: Set<string>;

  constructor(private readonly config: MockAdapterConfig) {
    if (!config.resolverAuthority || !config.authorizedCreators.length) {
      throw new HunchError("CONFIGURATION_ERROR", "Mock mode requires resolver and creator authorities");
    }
    this.now = config.clock ?? (() => Math.floor(Date.now() / 1000));
    this.creators = new Set(config.authorizedCreators);
  }

  private transaction(): TransactionResult {
    const result: TransactionResult = {
      mode: "mock", id: `mock:${++this.transactionSequence}`, signature: null, status: "confirmed",
    };
    this.transactions.set(result.id, result);
    return { ...result };
  }

  private requireMarket(id: string): Market {
    const market = this.markets.get(id);
    if (!market) throw new HunchError("MARKET_NOT_FOUND", `Unknown market: ${id}`);
    return market;
  }

  private view(market: Market): Market {
    const copy = structuredClone(market);
    if (copy.status === "open" && this.now() >= copy.closesAt) copy.status = "closed";
    return copy;
  }

  private positionKey(marketId: string, wallet: string, outcome: Outcome): string {
    return JSON.stringify([marketId, wallet, outcome]);
  }

  async createMarket(params: CreateMarketParams, signer: WalletSigner): Promise<CreateMarketResult> {
    const authority = signer.publicKey.toBase58();
    if (!this.creators.has(authority)) throw new HunchError("UNAUTHORIZED", "Wallet is not an authorized market creator");
    if (!Number.isSafeInteger(params.closesAt) || params.closesAt <= this.now()) {
      throw new HunchError("INVALID_DEADLINE", "Deadline must be a future integer Unix timestamp");
    }
    if (typeof params.question !== "string" || !params.question.trim() ||
        !Array.isArray(params.outcomes) || params.outcomes.length !== 2 ||
        params.outcomes.some((label) => typeof label !== "string" || !label.trim())) {
      throw new HunchError("INVALID_INPUT", "A question and two nonempty outcome labels are required");
    }
    if (params.resolverAuthority && params.resolverAuthority !== this.config.resolverAuthority) {
      throw new HunchError("UNAUTHORIZED", "Market resolver must match the configured trusted resolver");
    }
    if (params.id !== undefined && (typeof params.id !== "string" || !params.id.trim())) {
      throw new HunchError("INVALID_INPUT", "Market identifier must be nonempty");
    }
    let id = params.id;
    if (!id) {
      do { id = `mock-market-${++this.marketSequence}`; } while (this.markets.has(id));
    }
    if (this.markets.has(id)) throw new HunchError("MARKET_EXISTS", `Market already exists: ${id}`);
    const metadata = structuredClone({ question: params.question, outcomes: params.outcomes, description: params.description });
    const market: Market = {
      id, authority, resolverAuthority: this.config.resolverAuthority, tokenMint: null,
      metadata, question: metadata.question, outcomes: [...metadata.outcomes],
      closesAt: params.closesAt, status: "open", totalPool: 0n, pools: [0n, 0n], winningOutcome: null,
    };
    this.markets.set(id, market);
    const transaction = this.transaction();
    return { market: this.view(market), transaction, signature: transaction.signature };
  }

  async getMarket(marketId: string): Promise<Market | null> {
    const market = this.markets.get(marketId);
    return market ? this.view(market) : null;
  }

  async listMarkets(params: ListMarketsParams = {}): Promise<Market[]> {
    return [...this.markets.values()].map((market) => this.view(market)).filter((market) =>
      (!params.authority || params.authority === market.authority) &&
      (!params.status || params.status === market.status));
  }

  async predict(params: PredictParams, signer: WalletSigner): Promise<PredictResult> {
    assertOutcome(params.outcome);
    if (typeof params.amount !== "bigint" || params.amount <= 0n) {
      throw new HunchError("INVALID_AMOUNT", "Stake must be a positive bigint in token base units");
    }
    const market = this.requireMarket(params.marketId);
    if (this.view(market).status !== "open") throw new HunchError("MARKET_CLOSED", "Betting is closed");
    const wallet = signer.publicKey.toBase58();
    const key = this.positionKey(params.marketId, wallet, params.outcome);
    const position: Position = this.positions.get(key) ?? {
      marketId: params.marketId, wallet, outcome: params.outcome, amount: 0n, claimed: false, payout: 0n,
    };
    position.amount += params.amount;
    this.positions.set(key, position);
    market.pools[params.outcome] += params.amount;
    market.totalPool += params.amount;
    const transaction = this.transaction();
    return { position: { ...position }, transaction, signature: transaction.signature };
  }

  async getPositions(marketId: string, wallet?: string): Promise<Position[]> {
    this.requireMarket(marketId);
    return [...this.positions.values()].filter((position) =>
      position.marketId === marketId && (!wallet || position.wallet === wallet)).map((position) => ({ ...position }));
  }

  async resolveMarket(marketId: string, outcome: Outcome, signer: WalletSigner): Promise<TransactionResult> {
    assertOutcome(outcome);
    const market = this.requireMarket(marketId);
    if (market.resolverAuthority !== signer.publicKey.toBase58()) {
      throw new HunchError("UNAUTHORIZED", "Only the designated resolver can resolve this market");
    }
    if (market.status === "resolved") throw new HunchError("MARKET_RESOLVED", "Market is already resolved");
    if (this.view(market).status !== "closed") throw new HunchError("MARKET_NOT_CLOSED", "Resolution requires the betting deadline to pass");
    market.status = "resolved";
    market.winningOutcome = outcome;
    return this.transaction();
  }

  async claimWinnings(marketId: string, signer: WalletSigner): Promise<ClaimResult> {
    const market = this.requireMarket(marketId);
    if (market.status !== "resolved" || market.winningOutcome === null) {
      throw new HunchError("MARKET_NOT_RESOLVED", "Market has not been resolved");
    }
    const position = this.positions.get(this.positionKey(marketId, signer.publicKey.toBase58(), market.winningOutcome));
    if (!position) throw new HunchError("NO_WINNING_POSITION", "Wallet has no stake on the winning outcome");
    if (position.claimed) throw new HunchError("ALREADY_CLAIMED", "This winning position was already claimed");
    const winningPool = market.pools[market.winningOutcome];
    const payout = (position.amount * market.totalPool) / winningPool;
    position.claimed = true;
    position.payout = payout;
    const transaction = this.transaction();
    return { payout, transaction, signature: transaction.signature };
  }

  async getTransactionStatus(id: string): Promise<TransactionStatusResult> {
    const result = this.transactions.get(id);
    return result ? { ...result } : { mode: "mock", id, signature: null, status: "not_found" };
  }
}

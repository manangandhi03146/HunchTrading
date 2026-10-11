import type { Market, Outcome, Prediction } from "./legacy-types.js";

export interface MarketKitConfig {
  /** Solana RPC endpoint. Defaults to Devnet. */
  rpcUrl?: string;
  /** Deployed Anchor program id (set once Developer A deploys — ticket B4). */
  programId?: string;
  /**
   * When true, all calls hit an in-memory mock so Developer B/C can build
   * against the real interface before the contract exists (tickets B2, C2).
   * Flip to false after IDL integration (B4).
   */
  mock?: boolean;
  /** Optional clock for deterministic embedded mock tests. */
  clock?: () => number;
}

export interface CreateMarketParams {
  question: string;
  outcomes: [string, string];
  closesAt: number;
}

export interface PredictParams {
  marketId: string;
  outcome: Outcome;
  amount: bigint;
}

/**
 * Public SDK surface (plan §3, Developer B). Signatures are stable; the mock
 * implementation below is replaced piece-by-piece with real Solana calls.
 *
 * NOTE: Once integrated, mutating methods MUST return real transaction
 * signatures, never simulated identifiers.
 */
function validateOutcome(outcome: Outcome): void {
  if (outcome !== 0 && outcome !== 1) throw new Error("outcome must be 0 or 1");
}

function marketSnapshot(market: Market, now: number): Market {
  return {
    ...market,
    outcomes: [...market.outcomes],
    pools: [...market.pools],
    status:
      market.status === "open" && now >= market.closesAt
        ? "closed"
        : market.status,
  };
}

export class MarketKit {
  private readonly config: Required<Pick<MarketKitConfig, "rpcUrl" | "mock">> &
    MarketKitConfig;

  private now(): number { return this.config.clock?.() ?? Date.now() / 1000; }

  // --- mock state (removed once mock:false everywhere) ---
  private markets = new Map<string, Market>();
  private positions = new Map<string, Prediction>(); // key: `${marketId}:${wallet}:${outcome}`

  private claimedPositions = new Set<string>();

  constructor(config: MarketKitConfig = {}) {
    this.config = {
      ...config,
      rpcUrl: config.rpcUrl ?? "https://api.devnet.solana.com",
      mock: config.mock ?? true,
    };
  }

  async createMarket(
    params: CreateMarketParams,
  ): Promise<{ market: Market; signature: string }> {
    if (!this.config.mock)
      throw new Error("createMarket: real impl pending (ticket B4)");
    if (typeof params?.question !== "string" || !params.question.trim()) {
      throw new Error("question must not be empty");
    }
    if (
      !Array.isArray(params.outcomes) ||
      params.outcomes.length !== 2 ||
      params.outcomes.some(
        (label) => typeof label !== "string" || !label.trim(),
      ) ||
      params.outcomes[0].trim().toLowerCase() ===
        params.outcomes[1].trim().toLowerCase()
    )
      throw new Error("provide two distinct, non-empty outcome labels");
    if (
      !Number.isSafeInteger(params.closesAt) ||
      params.closesAt <= this.now()
    ) {
      throw new Error(
        "closesAt must be a future Unix timestamp in whole seconds",
      );
    }
    const id = `mkt_${Math.random().toString(36).slice(2, 10)}`;
    const market: Market = {
      id,
      question: params.question.trim(),
      outcomes: [params.outcomes[0].trim(), params.outcomes[1].trim()],
      closesAt: params.closesAt,
      status: "open",
      totalPool: 0n,
      pools: [0n, 0n],
      winningOutcome: null,
    };
    this.markets.set(id, market);
    return { market: marketSnapshot(market, this.now()), signature: "MOCK_SIGNATURE" };
  }

  async getMarket(marketId: string): Promise<Market | null> {
    if (!this.config.mock)
      throw new Error("getMarket: real impl pending (ticket B4)");
    const m = this.markets.get(marketId);
    return m ? marketSnapshot(m, this.now()) : null;
  }

  async predict(
    params: PredictParams,
  ): Promise<{ position: Prediction; signature: string }> {
    if (!this.config.mock)
      throw new Error("predict: real impl pending (ticket B4)");
    validateOutcome(params.outcome);
    if (typeof params.amount !== "bigint" || params.amount <= 0n) {
      throw new Error("amount must be a positive bigint in token base units");
    }
    const m = this.markets.get(params.marketId);
    if (!m) throw new Error(`unknown market ${params.marketId}`);
    if (m.status !== "open" || this.now() >= m.closesAt) {
      throw new Error("market is closed for predictions");
    }
    const wallet = "MockWallet1111111111111111111111111111111111";
    const key = `${params.marketId}:${wallet}:${params.outcome}`;
    const existing = this.positions.get(key);
    const position: Prediction = existing
      ? { ...existing, amount: existing.amount + params.amount }
      : {
          marketId: params.marketId,
          wallet,
          outcome: params.outcome,
          amount: params.amount,
        };
    this.positions.set(key, position);
    m.pools[params.outcome] += params.amount;
    m.totalPool += params.amount;
    return { position: { ...position }, signature: "MOCK_SIGNATURE" };
  }

  async resolveMarket(
    marketId: string,
    winningOutcome: Outcome,
  ): Promise<{ signature: string }> {
    if (!this.config.mock)
      throw new Error("resolveMarket: real impl pending (ticket B6)");
    validateOutcome(winningOutcome);
    const m = this.markets.get(marketId);
    if (!m) throw new Error(`unknown market ${marketId}`);
    if (m.status === "resolved" || m.status === "cancelled") {
      throw new Error("market is already finalized");
    }
    if (this.now() < m.closesAt)
      throw new Error("market must close before resolution");
    m.status = "resolved";
    m.winningOutcome = winningOutcome;
    return { signature: "MOCK_SIGNATURE" };
  }

  async claimWinnings(
    marketId: string,
  ): Promise<{ payout: bigint; signature: string }> {
    if (!this.config.mock)
      throw new Error("claimWinnings: real impl pending (ticket B7)");
    const m = this.markets.get(marketId);
    if (!m || m.status !== "resolved" || m.winningOutcome === null)
      throw new Error("market not resolved");
    const wallet = "MockWallet1111111111111111111111111111111111";
    const key = `${marketId}:${wallet}:${m.winningOutcome}`;
    const pos = this.positions.get(key);
    if (!pos) throw new Error("no winning position to claim");
    if (this.claimedPositions.has(key))
      throw new Error("payout already claimed");
    // proportional integer payout; rounding dust stays in vault (plan §3, A).
    const winningPool = m.pools[m.winningOutcome];
    const payout = (pos.amount * m.totalPool) / winningPool;
    // No asynchronous boundary between checking and recording a claim.
    this.claimedPositions.add(key);
    return { payout, signature: "MOCK_SIGNATURE" };
  }

  async getPositions(marketId: string, wallet?: string): Promise<Prediction[]> {
    if (!this.config.mock)
      throw new Error("getPositions: real impl pending (ticket B4)");
    return [...this.positions.values()]
      .filter(
        (p) => p.marketId === marketId && (!wallet || p.wallet === wallet),
      )
      .map((position) => ({ ...position }));
  }
}

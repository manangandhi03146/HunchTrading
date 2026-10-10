import { Market, Outcome, Prediction } from "./types";

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
export class MarketKit {
  private readonly config: Required<Pick<MarketKitConfig, "rpcUrl" | "mock">> & MarketKitConfig;

  // --- mock state (removed once mock:false everywhere) ---
  private markets = new Map<string, Market>();
  private positions = new Map<string, Prediction>(); // key: `${marketId}:${wallet}:${outcome}`

  constructor(config: MarketKitConfig = {}) {
    this.config = {
      rpcUrl: config.rpcUrl ?? "https://api.devnet.solana.com",
      mock: config.mock ?? true,
      ...config,
    };
  }

  async createMarket(params: CreateMarketParams): Promise<{ market: Market; signature: string }> {
    if (!this.config.mock) throw new Error("createMarket: real impl pending (ticket B4)");
    const id = `mkt_${Math.random().toString(36).slice(2, 10)}`;
    const market: Market = {
      id,
      question: params.question,
      outcomes: params.outcomes,
      closesAt: params.closesAt,
      status: "open",
      totalPool: 0n,
      pools: [0n, 0n],
      winningOutcome: null,
    };
    this.markets.set(id, market);
    return { market, signature: "MOCK_SIGNATURE" };
  }

  async getMarket(marketId: string): Promise<Market | null> {
    if (!this.config.mock) throw new Error("getMarket: real impl pending (ticket B4)");
    const m = this.markets.get(marketId);
    if (!m) return null;
    // derive open/closed from deadline
    if (m.status === "open" && Date.now() / 1000 > m.closesAt) m.status = "closed";
    return m;
  }

  async predict(params: PredictParams): Promise<{ position: Prediction; signature: string }> {
    if (!this.config.mock) throw new Error("predict: real impl pending (ticket B4)");
    const m = this.markets.get(params.marketId);
    if (!m) throw new Error(`unknown market ${params.marketId}`);
    const wallet = "MockWallet1111111111111111111111111111111111";
    const key = `${params.marketId}:${wallet}:${params.outcome}`;
    const existing = this.positions.get(key);
    const position: Prediction = existing
      ? { ...existing, amount: existing.amount + params.amount }
      : { marketId: params.marketId, wallet, outcome: params.outcome, amount: params.amount };
    this.positions.set(key, position);
    m.pools[params.outcome] += params.amount;
    m.totalPool += params.amount;
    return { position, signature: "MOCK_SIGNATURE" };
  }

  async resolveMarket(marketId: string, winningOutcome: Outcome): Promise<{ signature: string }> {
    if (!this.config.mock) throw new Error("resolveMarket: real impl pending (ticket B6)");
    const m = this.markets.get(marketId);
    if (!m) throw new Error(`unknown market ${marketId}`);
    m.status = "resolved";
    m.winningOutcome = winningOutcome;
    return { signature: "MOCK_SIGNATURE" };
  }

  async claimWinnings(marketId: string): Promise<{ payout: bigint; signature: string }> {
    if (!this.config.mock) throw new Error("claimWinnings: real impl pending (ticket B7)");
    const m = this.markets.get(marketId);
    if (!m || m.winningOutcome === null) throw new Error("market not resolved");
    const wallet = "MockWallet1111111111111111111111111111111111";
    const key = `${marketId}:${wallet}:${m.winningOutcome}`;
    const pos = this.positions.get(key);
    if (!pos) return { payout: 0n, signature: "MOCK_SIGNATURE" };
    // proportional integer payout; rounding dust stays in vault (plan §3, A).
    const winningPool = m.pools[m.winningOutcome];
    const payout = winningPool === 0n ? 0n : (pos.amount * m.totalPool) / winningPool;
    return { payout, signature: "MOCK_SIGNATURE" };
  }

  async getPositions(marketId: string, wallet?: string): Promise<Prediction[]> {
    if (!this.config.mock) throw new Error("getPositions: real impl pending (ticket B4)");
    return [...this.positions.values()].filter(
      (p) => p.marketId === marketId && (!wallet || p.wallet === wallet),
    );
  }
}

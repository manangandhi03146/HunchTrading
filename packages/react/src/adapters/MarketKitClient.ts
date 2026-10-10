import type {
  Claimable,
  CreateMarketParams,
  Market,
  MarketEvent,
  Mode,
  Outcome,
  Position,
  RaceState,
  TransactionResult,
} from "../types";

export interface MarketKitClient {
  readonly mode: Mode;
  readonly programId?: string;
  getMarket(id: string): Promise<Market>;
  listMarkets(): Promise<Market[]>;
  getPositions(id: string, walletAddress: string): Promise<Position[]>;
  getTokenBalance(walletAddress: string): Promise<bigint>;
  getClaimableAmount(id: string, walletAddress: string): Promise<Claimable>;
  predict(params: {
    marketId: string;
    outcome: Outcome;
    amount: bigint;
    walletAddress: string;
  }): Promise<TransactionResult>;
  claimWinnings(params: {
    marketId: string;
    outcome: Outcome;
    walletAddress: string;
  }): Promise<TransactionResult>;
  createMarket(
    params: CreateMarketParams,
  ): Promise<{ market: Market; transaction: TransactionResult }>;
  confirmTransaction(result: TransactionResult): Promise<TransactionResult>;
  getEvents(): Promise<MarketEvent[]>;
  getRace(id: string): Promise<RaceState>;
  startRace(id: string): Promise<RaceState>;
  newDemoRace(): Promise<Market>;
  subscribe?(listener: () => void): () => void;
}

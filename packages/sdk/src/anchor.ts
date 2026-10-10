import { HunchError } from "./types.js";
import type {
  HunchConfig, MarketAdapter, CreateMarketParams, CreateMarketResult, Market,
  ListMarketsParams, PredictParams, PredictResult, Position, WalletSigner,
  ClaimResult, TransactionResult, TransactionStatusResult, Outcome,
} from "./types.js";

export const ANCHOR_INTEGRATION_REQUIREMENTS = [
  "Actual generated Anchor IDL and TypeScript types, plus the Anchor version",
  "Deployed program ID and RPC cluster",
  "Test SPL mint, decimals, and token account/vault conventions",
  "Exact PDA seeds and market identifier encoding",
  "Instruction names, arguments, accounts, and required signers",
  "Market/position layouts, status representation, and program error codes",
  "Confirmed deadline, resolver authorization, payout, and claim semantics",
] as const;

/** Explicit integration boundary. No instruction, seed, or transaction is invented. */
export class AnchorMarketAdapter implements MarketAdapter {
  readonly mode = "anchor" as const;
  constructor(_config: Pick<HunchConfig, "rpcUrl" | "programId"> = {}) {
    this.unavailable();
  }
  private unavailable(): never {
    throw new HunchError("CONTRACT_UNAVAILABLE", "Anchor integration requires wiring Developer A's actual IDL and deployed contract", {
      requirements: ANCHOR_INTEGRATION_REQUIREMENTS,
    });
  }
  async createMarket(_params: CreateMarketParams, _signer: WalletSigner): Promise<CreateMarketResult> { return this.unavailable(); }
  async getMarket(_marketId: string): Promise<Market | null> { return this.unavailable(); }
  async listMarkets(_params?: ListMarketsParams): Promise<Market[]> { return this.unavailable(); }
  async predict(_params: PredictParams, _signer: WalletSigner): Promise<PredictResult> { return this.unavailable(); }
  async getPositions(_marketId: string, _wallet?: string): Promise<Position[]> { return this.unavailable(); }
  async claimWinnings(_marketId: string, _signer: WalletSigner): Promise<ClaimResult> { return this.unavailable(); }
  async getTransactionStatus(_id: string): Promise<TransactionStatusResult> { return this.unavailable(); }
  async resolveMarket(_marketId: string, _outcome: Outcome, _signer: WalletSigner): Promise<TransactionResult> { return this.unavailable(); }
}

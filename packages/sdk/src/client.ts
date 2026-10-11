import { PublicKey } from "@solana/web3.js";
import { AnchorMarketAdapter } from "./anchor.js";
import { MockMarketAdapter, createMockWallet } from "./mock.js";
import { HunchError } from "./types.js";
import type {
  HunchConfig, CreateMarketParams, PredictParams, ListMarketsParams, ClaimOptions, ResolveOptions,
  MarketAdapter, Outcome, WalletSigner,
} from "./types.js";

export type { CreateMarketParams, PredictParams } from "./types.js";
export type MarketKitConfig = HunchConfig;

export class Hunch {
  readonly adapter: MarketAdapter;
  readonly wallet?: WalletSigner;

  constructor(config: HunchConfig = {}) {
    const requestedMode = config.mode ?? (config.mock === false ? "anchor" : undefined);
    if (config.mode && config.mock !== undefined && config.mode !== (config.mock ? "mock" : "anchor")) {
      throw new HunchError("CONFIGURATION_ERROR", "mode and legacy mock setting disagree");
    }
    if (config.adapter) {
      if (requestedMode && requestedMode !== config.adapter.mode) {
        throw new HunchError("CONFIGURATION_ERROR", "Configured adapter does not match the selected mode");
      }
      this.adapter = config.adapter;
      this.wallet = config.wallet;
    } else if (requestedMode === "anchor") {
      this.adapter = new AnchorMarketAdapter(config);
      this.wallet = config.wallet;
    } else {
      this.wallet = config.wallet ?? createMockWallet(new PublicKey(new Uint8Array(32).fill(1)));
      this.adapter = new MockMarketAdapter({
        resolverAuthority: config.resolverAuthority ?? new PublicKey(new Uint8Array(32).fill(2)).toBase58(),
        authorizedCreators: config.authorizedCreators ?? [this.wallet.publicKey.toBase58()],
        clock: config.clock,
      });
    }
  }

  private signer(): WalletSigner {
    if (!this.wallet) throw new HunchError("WALLET_REQUIRED", "A wallet is required for this operation");
    return this.wallet;
  }

  createMarket(params: CreateMarketParams) { return this.adapter.createMarket(params, this.signer()); }
  getMarket(marketId: string) { return this.adapter.getMarket(marketId); }
  listMarkets(params?: ListMarketsParams) { return this.adapter.listMarkets(params); }
  predict(params: PredictParams) { return this.adapter.predict(params, this.signer()); }
  getPositions(marketId: string, wallet?: string) {
    return this.adapter.getPositions(marketId, wallet ?? this.wallet?.publicKey.toBase58());
  }
  claimWinnings(marketId: string, options?: ClaimOptions) { return this.adapter.claimWinnings(marketId, this.signer(), options); }
  getTransactionStatus(id: string) { return this.adapter.getTransactionStatus(id); }

  /** Trusted backend only. Resolver authority is enforced by the adapter. */
  resolveMarket(marketId: string, outcome: Outcome, options?: ResolveOptions) {
    return this.adapter.resolveMarket(marketId, outcome, this.signer(), options);
  }
}

/** @deprecated Use Hunch. Retained for Developer C's existing imports. */
export class MarketKit extends Hunch {}

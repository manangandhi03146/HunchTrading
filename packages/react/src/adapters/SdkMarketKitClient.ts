import { MarketKit } from "@marketkit/sdk";
import {
  Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import type { MarketKitClient } from "./MarketKitClient";
import { effectiveStatus } from "../types";
import type {
  Claimable,
  CreateMarketParams,
  Market,
  MarketEvent,
  Outcome,
  Position,
  RaceState,
  TransactionResult,
} from "../types";

export interface WalletSigner {
  publicKey: PublicKey | null;
  signTransaction?: <T extends Transaction | VersionedTransaction>(
    transaction: T,
  ) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ) => Promise<T[]>;
}
/** Frontend integration seam, not invented @marketkit/sdk exports. Developer B supplies these bindings. */
export interface SdkBindings {
  predict?: (
    params: { marketId: string; outcome: Outcome; amount: bigint },
    wallet: WalletSigner,
  ) => Promise<{ signature: string }>;
  claimWinnings?: (
    params: { marketId: string; outcome: Outcome },
    wallet: WalletSigner,
  ) => Promise<{ signature: string }>;
  createMarket?: (
    params: CreateMarketParams,
    wallet: WalletSigner,
  ) => Promise<{ market: Market; signature: string }>;
  getClaimableAmount?: (
    marketId: string,
    walletAddress: string,
  ) => Promise<Claimable>;
  getPositions?: (
    marketId: string,
    walletAddress: string,
  ) => Promise<Position[]>;
  listMarkets?: () => Promise<Market[]>;
  getEvents?: () => Promise<MarketEvent[]>;
  getRace?: (marketId: string) => Promise<RaceState>;
  startRace?: (marketId: string) => Promise<RaceState>;
}
export class SdkMarketKitClient implements MarketKitClient {
  readonly mode = "sdk" as const;
  readonly programId?: string;
  private readonly sdk: MarketKit;
  constructor(
    private readonly config: {
      connection: Connection;
      getWallet: () => WalletSigner;
      bindings?: SdkBindings;
      programId?: string;
      tokenMint?: string;
      sdk?: MarketKit;
    },
  ) {
    this.programId = config.programId;
    this.sdk =
      config.sdk ??
      new MarketKit({
        mock: false,
        rpcUrl: config.connection.rpcEndpoint,
        programId: config.programId,
      });
  }
  private missing(method: string): never {
    throw new Error(
      `Live ${method} is not connected yet. Developer B must provide the ${method} SDK binding. Switch VITE_MARKETKIT_MODE=mock to run the simulated demo.`,
    );
  }
  private async signer(walletAddress?: string) {
    // Even custom RPCs must prove they are Solana Devnet before signing.
    const genesis = await this.config.connection.getGenesisHash();
    if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1")
      throw new Error("MarketKit only signs transactions on Solana Devnet.");
    const wallet = this.config.getWallet();
    if (!wallet.publicKey || !wallet.signTransaction)
      throw new Error("Connect a wallet that supports transaction signing.");
    if (walletAddress && wallet.publicKey.toBase58() !== walletAddress)
      throw new Error(
        "The connected wallet changed. Review your prediction again.",
      );
    return wallet;
  }
  private transaction(signature: string): TransactionResult {
    if (
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature) ||
      signature.includes("MOCK")
    )
      throw new Error(
        "The SDK did not return a valid Solana transaction signature.",
      );
    return { signature, simulated: false, status: "submitted" };
  }
  async getMarket(id: string): Promise<Market> {
    const market = await this.sdk.getMarket(id);
    if (!market) throw new Error(`Market “${id}” was not found on Devnet.`);
    return market;
  }
  async listMarkets() {
    const fn = this.config.bindings?.listMarkets;
    return fn ? fn() : this.missing("listMarkets");
  }
  async getPositions(id: string, wallet: string): Promise<Position[]> {
    return this.config.bindings?.getPositions
      ? this.config.bindings.getPositions(id, wallet)
      : this.sdk.getPositions(id, wallet);
  }
  async getTokenBalance(walletAddress: string) {
    if (!this.config.tokenMint)
      throw new Error(
        "Set VITE_TEST_TOKEN_MINT to the zero-decimal Devnet test-token mint.",
      );
    const accounts = await this.config.connection.getParsedTokenAccountsByOwner(
      new PublicKey(walletAddress),
      { mint: new PublicKey(this.config.tokenMint) },
    );
    return accounts.value.reduce((sum, account) => {
      const balance = account.account.data.parsed.info.tokenAmount;
      if (balance.decimals !== 0)
        throw new Error("MarketKit requires a zero-decimal TEST mint.");
      return sum + BigInt(balance.amount);
    }, 0n);
  }
  async getClaimableAmount(id: string, wallet: string) {
    const fn = this.config.bindings?.getClaimableAmount;
    return fn ? fn(id, wallet) : this.missing("getClaimableAmount");
  }
  async predict(params: {
    marketId: string;
    outcome: Outcome;
    amount: bigint;
    walletAddress: string;
  }) {
    const fn = this.config.bindings?.predict;
    if (!fn) return this.missing("predict");
    const wallet = await this.signer(params.walletAddress);
    const result = await fn(
      {
        marketId: params.marketId,
        outcome: params.outcome,
        amount: params.amount,
      },
      wallet,
    );
    return this.transaction(result.signature);
  }
  async claimWinnings(params: {
    marketId: string;
    outcome: Outcome;
    walletAddress: string;
  }) {
    const fn = this.config.bindings?.claimWinnings;
    if (!fn) return this.missing("claimWinnings");
    const wallet = await this.signer(params.walletAddress);
    return this.transaction(
      (await fn({ marketId: params.marketId, outcome: params.outcome }, wallet))
        .signature,
    );
  }
  async createMarket(params: CreateMarketParams) {
    const fn = this.config.bindings?.createMarket;
    if (!fn) return this.missing("createMarket");
    const wallet = await this.signer();
    const result = await fn(params, wallet);
    return {
      market: result.market,
      transaction: this.transaction(result.signature),
    };
  }
  async confirmTransaction(result: TransactionResult) {
    if (result.simulated)
      throw new Error("Simulated transactions are not accepted in live mode.");
    for (let attempt = 0; attempt < 30; attempt++) {
      const status = (
        await this.config.connection.getSignatureStatuses([result.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (status?.err)
        throw new Error(
          `Solana rejected the transaction: ${JSON.stringify(status.err)}`,
        );
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      )
        return { ...result, status: "confirmed" as const };
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      "Transaction submitted, but confirmation timed out. Check its Explorer link before submitting again.",
    );
  }
  async getEvents() {
    const fn = this.config.bindings?.getEvents;
    if (!fn) return this.missing("getEvents");
    const events = await fn();
    if (events.some((event) => event.simulated))
      throw new Error("The live event source returned simulated data.");
    return events;
  }
  async getRace(id: string) {
    const fn = this.config.bindings?.getRace;
    if (!fn) return this.missing("getRace");
    const race = await fn(id);
    if (race.simulated)
      throw new Error("A live race cannot use a simulated fixture.");
    return race;
  }
  async startRace(id: string) {
    const market = await this.getMarket(id);
    if (
      effectiveStatus(market) !== "closed" ||
      Date.now() < market.closesAt * 1000
    )
      throw new Error("The market must close before starting the game server.");
    const fn = this.config.bindings?.startRace;
    if (!fn) return this.missing("startRace");
    const race = await fn(id);
    if (race.simulated)
      throw new Error("A live race cannot use a simulated fixture.");
    return race;
  }
  async newDemoRace(): Promise<Market> {
    throw new Error(
      "Live markets cannot be reset. Create or select a new market in the dashboard.",
    );
  }
}

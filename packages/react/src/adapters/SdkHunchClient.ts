import { Hunch, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_RESOLVER, HUNCH_DEVNET_TOKEN_MINT, HUNCH_PROGRAM_ID, type Market as ChainMarket } from "@hunch/sdk";
import {
  Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import type { HunchClient } from "./HunchClient";
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
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ) => Promise<T[]>;
}
/** Frontend integration seam, not invented @hunch/sdk exports. Developer B supplies these bindings. */
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
export class SdkHunchClient implements HunchClient {
  readonly mode = "sdk" as const;
  readonly programId?: string;
  private readonly sdk: Hunch;
  constructor(
    private readonly config: {
      connection: Connection;
      getWallet: () => WalletSigner;
      bindings?: SdkBindings;
      programId?: string;
      tokenMint?: string;
      sdk?: Hunch;
    },
  ) {
    config.tokenMint ??= HUNCH_DEVNET_TOKEN_MINT;
    this.programId = config.programId ?? HUNCH_PROGRAM_ID;
    this.sdk =
      config.sdk ??
      new Hunch({
        mock: false,
        connection: config.connection,
        tokenMint: config.tokenMint,
        resolverAuthority: HUNCH_DEVNET_RESOLVER,
        rpcUrl: config.connection.rpcEndpoint,
        programId: config.programId,
      });
  }
  private async metadata(market: ChainMarket): Promise<Market> {
    const view = this.view(market);
    if (typeof location === "undefined") return view;
    const response = await fetch("/v1/metadata", { cache: "no-store" });
    if (!response.ok) throw new Error("The shared metadata API is unavailable. Check the resolver hosting configuration.");
    const data = await response.json();
    const found = data.metadata?.find((m: { marketId: string }) => m.marketId === market.id);
    if (!found) return view;
    if (typeof found.question !== "string" || !Array.isArray(found.outcomes) || found.outcomes.length !== 2 || found.outcomes.some((label: unknown) => typeof label !== "string")) throw new Error("Invalid public market labels.");
    return { ...view, question: found.question, outcomes: found.outcomes, description: typeof found.description === "string" ? found.description : undefined };
  }
  private view(market: ChainMarket): Market {
    return { ...market, question: market.metadata?.question ?? market.question ?? `Market ${market.id}`, outcomes: market.metadata?.outcomes ?? market.outcomes ?? ["Outcome 0", "Outcome 1"], description: market.metadata?.description };
  }
  private missing(method: string): never {
    throw new Error(
      `Live ${method} is not connected yet. Developer B must provide the ${method} SDK binding. Switch VITE_HUNCH_MODE=mock to run the simulated demo.`,
    );
  }
  private async signer(walletAddress?: string) {
    // Even custom RPCs must prove they are Solana Devnet before signing.
    const genesis = await this.config.connection.getGenesisHash();
    if (genesis !== HUNCH_DEVNET_GENESIS_HASH)
      throw new Error("hunch only signs transactions on Solana Devnet.");
    const wallet = this.config.getWallet();
    if (!wallet.publicKey || !wallet.signTransaction)
      throw new Error("Connect a wallet that supports transaction signing.");
    if (walletAddress && wallet.publicKey.toBase58() !== walletAddress)
      throw new Error(
        "The connected wallet changed. Review your prediction again.",
      );
    return { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction.bind(wallet) };
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
    return this.metadata(market);
  }
  async listMarkets() {
    const fn = this.config.bindings?.listMarkets;
    return fn ? fn() : Promise.all((await this.sdk.listMarkets()).map(m => this.metadata(m)));
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
        throw new Error("hunch requires a zero-decimal TEST mint.");
      return sum + BigInt(balance.amount);
    }, 0n);
  }
  async getClaimableAmount(id: string, wallet: string) {
    const fn = this.config.bindings?.getClaimableAmount;
    if (fn) return fn(id, wallet);
    const market = await this.getMarket(id);
    const positions = await this.getPositions(id, wallet);
    const position = positions.find(p => p.outcome === market.winningOutcome);
    return { claimed: position?.claimed ?? false, amount: market.status === "resolved" && position && !position.claimed && market.pools[position.outcome] > 0n ? position.amount * market.totalPool / market.pools[position.outcome] : 0n };
  }
  async predict(params: {
    marketId: string;
    outcome: Outcome;
    amount: bigint;
    walletAddress: string;
  }) {
    const fn = this.config.bindings?.predict;
    if (!fn) { const wallet = await this.signer(params.walletAddress); const result = await this.sdk.adapter.predict(params, wallet); if (!result.signature) throw new Error("No on-chain signature returned."); return this.transaction(result.signature); }
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
    if (!fn) { const wallet = await this.signer(params.walletAddress); const result = await this.sdk.adapter.claimWinnings(params.marketId, wallet, { createAssociatedTokenAccount: true }); if (!result.signature) throw new Error("No on-chain signature returned."); return this.transaction(result.signature); }
    const wallet = await this.signer(params.walletAddress);
    return this.transaction(
      (await fn({ marketId: params.marketId, outcome: params.outcome }, wallet))
        .signature,
    );
  }
  async createMarket(params: CreateMarketParams) {
    const fn = this.config.bindings?.createMarket;
    if (!fn) {
      const wallet = await this.signer();
      if (!this.config.getWallet().signMessage) throw new Error("Use a wallet that supports signing market metadata messages.");
      const health = await fetch("/health"); const status = await health.json();
      if (!health.ok || status.mode !== "anchor") throw new Error("Start the live Devnet resolver and metadata API before creating a public market.");
      const result = await this.sdk.adapter.createMarket(params, wallet);
      if (!result.signature) throw new Error("No on-chain signature returned.");
      const metadata = { marketId: result.market.id, question: params.question, outcomes: params.outcomes, ...(params.description ? { description: params.description } : {}) };
      try {
        const bytes = await this.config.getWallet().signMessage!(new TextEncoder().encode(`hunch:market-metadata:v1\n${JSON.stringify(metadata)}`));
        const signature = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
        const response = await fetch("/v1/metadata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ metadata, signature }) });
        if (!response.ok) throw new Error("Metadata publication rejected.");
      } catch {
        throw new Error(`Market ${result.market.id} was created. Metadata publication failed. Transaction: ${result.signature}. Do not create it again; recover metadata using the hosting runbook.`);
      }
      return { market: this.view(result.market), transaction: this.transaction(result.signature) };
    }
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
    const response = fn ? undefined : await fetch("/v1/activity", { cache: "no-store" });
    if (response && !response.ok) throw new Error("Live activity is unavailable.");
    const events: MarketEvent[] = fn ? await fn() : (await response!.json()).events;
    if (!Array.isArray(events)) throw new Error("Invalid activity response.");
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

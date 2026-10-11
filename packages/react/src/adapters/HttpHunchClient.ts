import { HttpMockMarketAdapter, type Market as SharedMarket, type HttpMockSession } from "@hunch/sdk";
import type { HunchClient } from "./HunchClient";
import type { CreateMarketParams, Market, MarketEvent, Outcome, RaceState, TransactionResult } from "../types";

/** Browser facade over the resolver-owned demo ledger. It never resolves markets. */
export class HttpHunchClient implements HunchClient {
  readonly mode = "mock" as const;
  readonly shared = true;
  get demoWalletAddress() { return this.adapter.wallet!.publicKey.toBase58(); }
  private constructor(private readonly adapter: HttpMockMarketAdapter, private readonly baseUrl: string) {}
  static async connect(baseUrl: string) {
    const key = `hunch:shared-session:${baseUrl}`;
    let session: HttpMockSession | undefined;
    try { session = JSON.parse(sessionStorage.getItem(key) ?? "null") ?? undefined; } catch { /* New session. */ }
    let adapter = await HttpMockMarketAdapter.connect({ baseUrl, appId: "hunch-web", session, label: "Hunch demo participant" });
    // Old sessions are invalid after a development backend restart.
    if (session) {
      const response = await fetch(`${baseUrl}/v1/mock/balance`, { headers: { "x-hunch-mock-session": session.sessionToken } });
      if (response.status === 401) adapter = await HttpMockMarketAdapter.connect({ baseUrl, appId: "hunch-web", label: "Hunch demo participant" });
      else if (!response.ok) throw new Error("Shared demo backend is unavailable.");
    }
    try { sessionStorage.setItem(key, JSON.stringify(adapter.session)); } catch { /* Session remains in memory. */ }
    return new HttpHunchClient(adapter, baseUrl);
  }
  private view(m: SharedMarket): Market { return { ...m, question: m.metadata?.question ?? m.question ?? m.id, outcomes: m.metadata?.outcomes ?? m.outcomes ?? ["Outcome 0", "Outcome 1"], description: m.metadata?.description }; }
  private receipt(id: string): TransactionResult { return { signature: id, simulated: true, status: "confirmed" }; }
  async getMarket(id: string) { const market = await this.adapter.getMarket(id); if (!market) throw new Error("Market not found. Check its link or return to Explore markets."); return this.view(market); }
  async listMarkets() { return (await this.adapter.listMarkets()).map(m => this.view(m)); }
  async getPositions(id: string, wallet: string) { return this.adapter.getPositions(id, wallet); }
  async getTokenBalance(wallet: string) {
    if (wallet !== this.demoWalletAddress) throw new Error("Connect your own shared demo account.");
    const response = await fetch(`${this.baseUrl}/v1/mock/balance`, { headers: { "x-hunch-mock-session": this.adapter.session!.sessionToken }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.simulated !== true || !/^\d+$/.test(data.balance)) throw new Error("Could not load the shared demo balance.");
    return BigInt(data.balance);
  }
  async getClaimableAmount(id: string, wallet: string) {
    const m = await this.getMarket(id), positions = await this.getPositions(id, wallet);
    const p = positions.find(p => p.outcome === m.winningOutcome);
    return { claimed: p?.claimed ?? false, amount: m.status === "resolved" && p && !p.claimed && m.pools[p.outcome] > 0n ? p.amount * m.totalPool / m.pools[p.outcome] : 0n };
  }
  private actor(wallet: string) { if (wallet !== this.demoWalletAddress) throw new Error("Demo account changed. Review your prediction again."); return this.adapter.wallet!; }
  async predict(p: { marketId: string; outcome: Outcome; amount: bigint; walletAddress: string }) { return this.receipt((await this.adapter.predict(p, this.actor(p.walletAddress))).transaction.id); }
  async claimWinnings(p: { marketId: string; outcome: Outcome; walletAddress: string }) { return this.receipt((await this.adapter.claimWinnings(p.marketId, this.actor(p.walletAddress))).transaction.id); }
  async createMarket(p: CreateMarketParams) { const r = await this.adapter.createMarket(p, this.adapter.wallet!); return { market: this.view(r.market), transaction: this.receipt(r.transaction.id) }; }
  async confirmTransaction(r: TransactionResult) { const status = await this.adapter.getTransactionStatus(r.signature); if (!r.simulated || status.status !== "confirmed") throw new Error("Demo operation was not confirmed. Inspect the market before retrying."); return r; }
  async getEvents(): Promise<MarketEvent[]> { const response = await fetch(`${this.baseUrl}/v1/activity`, { cache: "no-store" }); if (!response.ok) throw new Error("Shared activity is unavailable."); const data = await response.json(); if (!Array.isArray(data.events) || data.events.some((event: MarketEvent) => event.simulated !== true)) throw new Error("Invalid shared demo activity."); return data.events; }
  async getRace(id: string): Promise<RaceState> { if (id !== "race-42") throw new Error("This market is not mapped to the shared race fixture. Open its dedicated market page."); return this.raceRequest(id, false); }
  private async raceRequest(id: string, start: boolean): Promise<RaceState> {
    const response = await fetch(`${this.baseUrl}/v1/mock/races/${encodeURIComponent(id)}${start ? "/start" : ""}`, { method: start ? "POST" : "GET", cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Shared race is unavailable.");
    if (data.simulated !== true || data.marketId !== id || !["upcoming", "racing", "finished"].includes(data.status)) throw new Error("Invalid shared race state.");
    return data;
  }
  async startRace(id: string): Promise<RaceState> { if (id !== "race-42") throw new Error("Only the registered race fixture can start here."); return this.raceRequest(id, true); }
  async newDemoRace(): Promise<Market> { throw new Error("Create a new shared market from the Create market page."); }
}

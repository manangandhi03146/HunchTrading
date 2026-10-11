import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { createMockWallet } from "./mock.js";
import { HunchError } from "./types.js";
import type {
  MarketAdapter, WalletSigner, CreateMarketParams, CreateMarketResult, Market,
  ListMarketsParams, PredictParams, PredictResult, Position, ClaimResult,
  TransactionResult, TransactionStatusResult, Outcome, HunchErrorCode,
} from "./types.js";

const amount = z.string().regex(/^(0|[1-9][0-9]*)$/).transform((value) => BigInt(value));
const outcome = z.union([z.literal(0), z.literal(1)]);
const marketSchema = z.object({
  id: z.string(), authority: z.string(), resolverAuthority: z.string(), tokenMint: z.null(),
  closesAt: z.number().int(), status: z.enum(["open", "closed", "resolved", "cancelled"]),
  totalPool: amount, pools: z.tuple([amount, amount]), winningOutcome: outcome.nullable(),
  metadata: z.object({ question: z.string(), outcomes: z.tuple([z.string(), z.string()]), description: z.string().optional() }).nullable(),
  question: z.string().optional(), outcomes: z.tuple([z.string(), z.string()]).optional(),
});
const positionSchema = z.object({
  marketId: z.string(), wallet: z.string(), outcome, amount,
  claimed: z.boolean(), payout: amount,
});
const transactionSchema = z.object({
  mode: z.literal("mock"), id: z.string().regex(/^mock:[0-9]+$/), signature: z.null(), status: z.literal("confirmed"),
});
const sessionSchema = z.object({
  mode: z.literal("mock"), simulated: z.literal(true), sessionToken: z.string().min(32),
  wallet: z.string(), label: z.string(),
});
const envelopeSchema = z.object({ mode: z.literal("mock"), simulated: z.literal(true) }).passthrough();
const sdkErrorCodes = new Set<string>([
  "INVALID_INPUT", "INVALID_OUTCOME", "INVALID_AMOUNT", "INVALID_DEADLINE", "MARKET_NOT_FOUND",
  "MARKET_EXISTS", "MARKET_CLOSED", "MARKET_NOT_CLOSED", "MARKET_RESOLVED", "MARKET_NOT_RESOLVED",
  "UNAUTHORIZED", "NO_WINNING_POSITION", "ALREADY_CLAIMED", "WALLET_REQUIRED", "CONFIGURATION_ERROR",
  "CONTRACT_UNAVAILABLE", "TRANSACTION_FAILED", "TRANSACTION_UNCERTAIN",
]);

export type HttpMockSession = z.infer<typeof sessionSchema>;
export interface HttpMockAdapterOptions {
  baseUrl: string;
  /** Required to create markets; this app must be registered by the backend. */
  appId?: string;
  /** Only needed when the backend explicitly enables authenticated demo access. */
  accessToken?: string;
  /** Reuse a server-issued simulated identity, e.g. after a frontend reload. */
  session?: HttpMockSession;
  label?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** One resolver owns the ledger. This adapter never owns pools or signs Solana transactions. */
export class HttpMockMarketAdapter implements MarketAdapter {
  readonly mode = "mock" as const;
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private currentSession?: HttpMockSession;

  constructor(private readonly options: HttpMockAdapterOptions) {
    const url = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new HunchError("CONFIGURATION_ERROR", "baseUrl must be an HTTP(S) origin without credentials, path, query, or fragment");
    }
    this.baseUrl = url.origin;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new HunchError("CONFIGURATION_ERROR", "timeoutMs must be a positive integer");
    if (options.session) this.currentSession = this.parse(sessionSchema, options.session);
  }

  /** Issues a fresh simulated identity. No real wallet address or signature is sent. */
  static async connect(options: HttpMockAdapterOptions): Promise<HttpMockMarketAdapter> {
    const adapter = new HttpMockMarketAdapter(options);
    if (!adapter.currentSession) adapter.currentSession = adapter.parse(sessionSchema,
      await adapter.request("POST", "/v1/mock/sessions", { label: options.label }));
    // Validate the simulated public identity before exposing it as WalletSigner.
    adapter.wallet;
    return adapter;
  }

  get session(): HttpMockSession | undefined { return this.currentSession ? { ...this.currentSession } : undefined; }
  get wallet(): WalletSigner | undefined {
    if (!this.currentSession) return undefined;
    try { return createMockWallet(new PublicKey(this.currentSession.wallet)); }
    catch { throw new HunchError("INVALID_RESPONSE", "Backend returned an invalid simulated identity"); }
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new HunchError("INVALID_RESPONSE", "Backend returned an invalid mock response");
    return parsed.data;
  }
  private requireIdentity(signer: WalletSigner): void {
    if (!this.currentSession || signer.publicKey.toBase58() !== this.currentSession.wallet) {
      throw new HunchError("UNAUTHORIZED", "Use the simulated wallet issued for this HTTP adapter's session");
    }
  }
  private async request(method: "GET" | "POST", path: string, payload?: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (this.options.accessToken) headers.authorization = `Bearer ${this.options.accessToken}`;
    if (this.currentSession) headers["x-hunch-mock-session"] = this.currentSession.sessionToken;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method, headers, body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal, credentials: "omit", cache: "no-store",
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).safeParse(raw);
        const code = error.success && sdkErrorCodes.has(error.data.error.code) ? error.data.error.code as HunchErrorCode : "HTTP_ERROR";
        throw new HunchError(code, error.success ? error.data.error.message : "Mock HTTP request failed", {
          status: response.status, backendCode: error.success ? error.data.error.code : undefined,
        });
      }
      return this.parse(envelopeSchema, raw);
    } catch (error) {
      if (error instanceof HunchError) throw error;
      if (error instanceof SyntaxError) throw new HunchError("INVALID_RESPONSE", "Backend response was not JSON");
      throw new HunchError("NETWORK_ERROR", "Mock HTTP request failed or timed out; mutations are never automatically retried", { method });
    } finally { clearTimeout(timer); }
  }

  async createMarket(params: CreateMarketParams, signer: WalletSigner): Promise<CreateMarketResult> {
    this.requireIdentity(signer);
    if (!this.options.appId) throw new HunchError("CONFIGURATION_ERROR", "Set appId to create a market for a registered application");
    const data = await this.request("POST", "/v1/mock/markets", { ...params, appId: this.options.appId });
    return this.parse(z.object({ market: marketSchema, transaction: transactionSchema, signature: z.null() }), data);
  }
  async getMarket(marketId: string): Promise<Market | null> {
    const data = await this.request("GET", `/v1/mock/markets/${encodeURIComponent(marketId)}`);
    return this.parse(marketSchema.nullable(), data.market);
  }
  async listMarkets(params: ListMarketsParams = {}): Promise<Market[]> {
    const query = new URLSearchParams();
    if (params.authority) query.set("authority", params.authority);
    if (params.status) query.set("status", params.status);
    const data = await this.request("GET", `/v1/mock/markets${query.size ? `?${query}` : ""}`);
    return this.parse(z.array(marketSchema), data.markets);
  }
  async predict(params: PredictParams, signer: WalletSigner): Promise<PredictResult> {
    this.requireIdentity(signer);
    if (typeof params.amount !== "bigint" || params.amount <= 0n) throw new HunchError("INVALID_AMOUNT", "Stake must be a positive bigint");
    const data = await this.request("POST", `/v1/mock/markets/${encodeURIComponent(params.marketId)}/predictions`, { outcome: params.outcome, amount: params.amount.toString() });
    return this.parse(z.object({ position: positionSchema, transaction: transactionSchema, signature: z.null() }), data);
  }
  async getPositions(marketId: string, wallet?: string): Promise<Position[]> {
    const query = wallet ? `?${new URLSearchParams({ wallet })}` : "";
    const data = await this.request("GET", `/v1/mock/markets/${encodeURIComponent(marketId)}/positions${query}`);
    return this.parse(z.array(positionSchema), data.positions);
  }
  async claimWinnings(marketId: string, signer: WalletSigner): Promise<ClaimResult> {
    this.requireIdentity(signer);
    const data = await this.request("POST", `/v1/mock/markets/${encodeURIComponent(marketId)}/claims`, {});
    return this.parse(z.object({ payout: amount, transaction: transactionSchema, signature: z.null() }), data);
  }
  async getTransactionStatus(id: string): Promise<TransactionStatusResult> {
    const data = await this.request("GET", `/v1/mock/transactions/${encodeURIComponent(id)}`);
    return this.parse(z.object({ mode: z.literal("mock"), id: z.string(), signature: z.null(), status: z.enum(["confirmed", "not_found"]) }), data.transaction);
  }
  async resolveMarket(_marketId: string, _outcome: Outcome, _signer: WalletSigner): Promise<TransactionResult> {
    throw new HunchError("UNAUTHORIZED", "HTTP clients cannot resolve markets; submit a signed backend event to /v1/events");
  }
}

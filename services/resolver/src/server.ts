import Fastify from "fastify";
import cors from "@fastify/cors";
import { HunchError } from "@hunch/sdk";
import type { Market, MarketAdapter, TransactionResult, WalletSigner } from "@hunch/sdk";
import { ResolverStore } from "./store.js";
import type { EventRecord, Settlement } from "./store.js";
import { eventSchema, identifier, payloadHash, verifyEventSignature, validateTimestamp, ResolverError } from "./validation.js";
import { MOCK_CORS_HEADERS, mockHttpOrigins, registerMockHttp, validateOrigins } from "./mock-http.js";
import type { MockHttpOptions } from "./mock-http.js";

export interface ResolverOptions {
  adapter: MarketAdapter;
  signer: WalletSigner;
  store: ResolverStore;
  clock?: () => number;
  maxEventAgeSeconds?: number;
  maxFutureSkewSeconds?: number;
  logger?: boolean;
  /** Real mode: only markets escrowing this mint are settled. Creation is permissionless on-chain. */
  tokenMint?: string;
  /** Exact browser origins allowed to read event status. Independent of mock mode; none by default. */
  corsOrigins?: readonly string[];
  /** Explicit opt-in. Never enabled for an Anchor adapter. */
  mockHttp?: MockHttpOptions;
}

function responseStatus(record: EventRecord): number {
  return ["received", "processing", "submitted"].includes(record.status) ? 202 : 200;
}

// Market reads happen before any reservation, so these are safe to retry with the same signed event.
const READ_ERRORS: Partial<Record<HunchError["code"], [number, string, string]>> = {
  INVALID_INPUT: [400, "INVALID_MARKET_ID", "Registered market ID is not a valid market address"],
  NETWORK_ERROR: [503, "RPC_UNAVAILABLE", "Market state is temporarily unavailable; retry the same signed event"],
  INVALID_RESPONSE: [502, "INVALID_MARKET_ACCOUNT", "Market account is not a valid Hunch market"],
};

/** Settled only when the market itself records this event's outcome. */
export function verifiedSettlement(market: Market | null, outcome: EventRecord["outcome"], now: number,
  source: Settlement["source"]): Settlement | null {
  return market?.status === "resolved" && market.winningOutcome === outcome
    ? { marketStatus: "resolved", winningOutcome: outcome, verifiedAt: now, source } : null;
}

export function buildServer(options: ResolverOptions) {
  const { adapter, signer, store } = options;
  const now = options.clock ?? (() => Math.floor(Date.now() / 1000));
  const maxAge = options.maxEventAgeSeconds ?? 300;
  const futureSkew = options.maxFutureSkewSeconds ?? 30;
  if (![maxAge, futureSkew].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Event timestamp limits must be nonnegative integer seconds");
  }
  const mockOrigins = options.mockHttp ? mockHttpOrigins(options.mockHttp, adapter) : [];
  const origins = [...new Set([...validateOrigins(options.corsOrigins ?? []), ...mockOrigins])];
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16 * 1024 });
  // One CORS policy for the whole server, registered before any route.
  if (origins.length) {
    app.register(cors, { origin: origins, methods: ["GET", "POST"], maxAge: 600,
      allowedHeaders: ["Content-Type", ...(options.mockHttp ? MOCK_CORS_HEADERS : [])] });
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ResolverError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const errorStatus = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
    const status = typeof errorStatus === "number" && errorStatus >= 400 && errorStatus < 500 ? errorStatus : 500;
    app.log.error({ code: "REQUEST_FAILED", status }, "Resolver request failed");
    return reply.code(status).send({ error: { code: "REQUEST_FAILED", message: status === 500 ? "Resolver request failed" : "Invalid request" } });
  });
  app.get("/health", async () => adapter.mode === "mock"
    ? { ok: true, mode: adapter.mode, pendingEvents: store.pendingCount() }
    : { ok: true, mode: adapter.mode, network: "devnet", resolver: signer.publicKey.toBase58(), pendingEvents: store.pendingCount() });
  app.get<{ Params: { eventId: string } }>("/v1/events/:eventId", async (request, reply) => {
    if (!identifier.safeParse(request.params.eventId).success) throw new ResolverError(400, "INVALID_EVENT_ID", "Invalid event identifier");
    const event = store.getEvent(request.params.eventId);
    if (!event) throw new ResolverError(404, "EVENT_NOT_FOUND", "Event not found");
    return reply.send(event);
  });

  async function readMarket(marketId: string): Promise<Market | null> {
    try { return await adapter.getMarket(marketId); }
    catch (error) {
      const mapped = error instanceof HunchError ? READ_ERRORS[error.code] : undefined;
      if (mapped) throw new ResolverError(...mapped);
      throw error;
    }
  }

  app.post("/v1/events", async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) throw new ResolverError(400, "INVALID_EVENT", "Expected appId, eventId, marketId, outcome (0 or 1), integer timestamp, and base64 signature");
    const event = parsed.data;
    const application = store.getApp(event.appId);
    if (!application?.enabled) throw new ResolverError(403, "UNKNOWN_APPLICATION", "Application is not registered or is disabled");
    if (!verifyEventSignature(event, application.publicKey)) throw new ResolverError(401, "INVALID_SIGNATURE", "Event signature does not match the registered application key");
    // Only administratively registered markets are eligible; the client cannot nominate one.
    const mapping = store.getMarketMapping(event.marketId);
    if (!mapping || mapping.appId !== event.appId) throw new ResolverError(403, "UNAUTHORIZED_MARKET", "Market does not belong to the registered application");
    if (mapping.eventId !== event.eventId) throw new ResolverError(403, "UNAUTHORIZED_EVENT", "Event ID is not authorized to resolve this market");
    const hash = payloadHash(event);
    const existing = store.existingEvent(event.eventId, hash, adapter.mode);
    // Already accepted events remain idempotent even after their freshness window.
    if (existing) return reply.code(responseStatus(existing)).send(existing);
    validateTimestamp(event.timestamp, now(), maxAge, futureSkew);
    const market = await readMarket(event.marketId);
    const raced = store.existingEvent(event.eventId, hash, adapter.mode);
    if (raced) return reply.code(responseStatus(raced)).send(raced);
    if (!market) throw new ResolverError(404, "MARKET_NOT_FOUND", "Registered market does not exist in the adapter");
    if (market.authority !== mapping.authority || market.resolverAuthority !== mapping.resolverAuthority ||
        market.resolverAuthority !== signer.publicKey.toBase58()) {
      throw new ResolverError(403, "MARKET_AUTHORITY_MISMATCH", "Market ownership or resolver authority does not match its registration");
    }
    if (options.tokenMint !== undefined && market.tokenMint !== options.tokenMint) {
      throw new ResolverError(403, "MARKET_MINT_MISMATCH", "Market does not escrow the approved token mint");
    }
    // Backend deadline enforcement: the deployed contract does not check it in resolve_market.
    if (market.status !== "closed" || now() < market.closesAt || event.timestamp < market.closesAt) {
      throw new ResolverError(422, "MARKET_INELIGIBLE", "Market must be closed and the result timestamp must be at or after its deadline");
    }
    const reservation = store.receive(event, hash, adapter.mode, now());
    if (!reservation.created) return reply.code(responseStatus(reservation.record)).send(reservation.record);
    store.updateEvent(event.eventId, "received", "processing", now());
    const current = () => store.getEvent(event.eventId)!;
    let transaction: TransactionResult;
    try {
      transaction = await adapter.resolveMarket(event.marketId, event.outcome, signer, {
        // Persisted before broadcast: a crash or timeout always leaves a signature to reconcile.
        onSigned: ({ signature, lastValidBlockHeight }) => { store.recordSigned(event.eventId, signature, lastValidBlockHeight, now()); },
      });
    } catch (error) {
      const record = current();
      const details = error instanceof HunchError ? error.details : undefined;
      const signature = typeof details?.signature === "string" ? details.signature : record.transaction?.signature ?? null;
      // A signature that may have reached the cluster is never treated as a definite failure.
      const uncertain = error instanceof HunchError
        ? error.code === "TRANSACTION_UNCERTAIN" || details?.stage === "verification"
        : adapter.mode === "anchor";
      const code = error instanceof HunchError ? (details?.stage === "verification" ? "VERIFICATION_PENDING" : error.code) : uncertain ? "TRANSACTION_UNCERTAIN" : "RESOLUTION_FAILED";
      const message = error instanceof HunchError ? error.message : uncertain ? "Resolution outcome is uncertain; manual reconciliation is required" : "Resolution failed";
      const recorded: TransactionResult | null = signature && adapter.mode === "anchor"
        ? { mode: "anchor", id: signature, signature, status: uncertain ? "submitted" : "failed" } : null;
      // Never retry an uncertain or failed accepted event automatically; reconcile first.
      const updated = store.updateEvent(event.eventId, record.status, uncertain ? "submitted" : "failed", now(), recorded, { code, message });
      app.log.error({ eventId: event.eventId, code, signature }, "Resolution did not confirm");
      return reply.code(uncertain ? 202 : 502).send(updated);
    }
    // Never report settlement from a receipt alone: read the market back independently.
    let settlement: Settlement | null = null;
    try { settlement = verifiedSettlement(await adapter.getMarket(event.marketId), event.outcome, now(), "transaction"); }
    catch { settlement = null; }
    const record = settlement && transaction.status === "confirmed"
      ? store.updateEvent(event.eventId, current().status, "confirmed", now(), transaction, null, settlement)
      : store.updateEvent(event.eventId, current().status, transaction.status === "failed" ? "failed" : "submitted", now(), transaction,
        transaction.status === "failed"
          ? { code: "TRANSACTION_FAILED", message: "Resolution transaction failed" }
          : { code: "VERIFICATION_PENDING", message: "Transaction reported, but the market does not yet show this outcome; reconcile before any retry" });
    return reply.code(responseStatus(record)).send(record);
  });
  if (options.mockHttp) registerMockHttp(app, options.mockHttp, adapter, signer, store);
  return app;
}

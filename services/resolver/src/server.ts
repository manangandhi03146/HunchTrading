import Fastify from "fastify";
import { HunchError } from "@hunch/sdk";
import type { MarketAdapter, WalletSigner } from "@hunch/sdk";
import { ResolverStore } from "./store.js";
import type { EventRecord } from "./store.js";
import { eventSchema, identifier, payloadHash, verifyEventSignature, validateTimestamp, ResolverError } from "./validation.js";
import { registerMockHttp } from "./mock-http.js";
import type { MockHttpOptions } from "./mock-http.js";

export interface ResolverOptions {
  adapter: MarketAdapter;
  signer: WalletSigner;
  store: ResolverStore;
  clock?: () => number;
  maxEventAgeSeconds?: number;
  maxFutureSkewSeconds?: number;
  logger?: boolean;
  /** Explicit opt-in. Never enabled for an Anchor adapter. */
  mockHttp?: MockHttpOptions;
}

function responseStatus(record: EventRecord): number {
  return ["received", "processing", "submitted"].includes(record.status) ? 202 : 200;
}

export function buildServer(options: ResolverOptions) {
  const { adapter, signer, store } = options;
  const now = options.clock ?? (() => Math.floor(Date.now() / 1000));
  const maxAge = options.maxEventAgeSeconds ?? 300;
  const futureSkew = options.maxFutureSkewSeconds ?? 30;
  if (![maxAge, futureSkew].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Event timestamp limits must be nonnegative integer seconds");
  }
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16 * 1024 });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ResolverError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const errorStatus = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
    const status = typeof errorStatus === "number" && errorStatus >= 400 && errorStatus < 500 ? errorStatus : 500;
    app.log.error({ code: "REQUEST_FAILED", status }, "Resolver request failed");
    return reply.code(status).send({ error: { code: "REQUEST_FAILED", message: status === 500 ? "Resolver request failed" : "Invalid request" } });
  });
  app.get("/health", async () => ({ ok: true, mode: adapter.mode, pendingEvents: store.pendingCount() }));
  app.get<{ Params: { eventId: string } }>("/v1/events/:eventId", async (request, reply) => {
    if (!identifier.safeParse(request.params.eventId).success) throw new ResolverError(400, "INVALID_EVENT_ID", "Invalid event identifier");
    const event = store.getEvent(request.params.eventId);
    if (!event) throw new ResolverError(404, "EVENT_NOT_FOUND", "Event not found");
    return reply.send(event);
  });
  app.post("/v1/events", async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) throw new ResolverError(400, "INVALID_EVENT", "Expected appId, eventId, marketId, outcome (0 or 1), integer timestamp, and base64 signature");
    const event = parsed.data;
    const application = store.getApp(event.appId);
    if (!application?.enabled) throw new ResolverError(403, "UNKNOWN_APPLICATION", "Application is not registered or is disabled");
    if (!verifyEventSignature(event, application.publicKey)) throw new ResolverError(401, "INVALID_SIGNATURE", "Event signature does not match the registered application key");
    const mapping = store.getMarketMapping(event.marketId);
    if (!mapping || mapping.appId !== event.appId) throw new ResolverError(403, "UNAUTHORIZED_MARKET", "Market does not belong to the registered application");
    if (mapping.eventId !== event.eventId) throw new ResolverError(403, "UNAUTHORIZED_EVENT", "Event ID is not authorized to resolve this market");
    const hash = payloadHash(event);
    const existing = store.existingEvent(event.eventId, hash, adapter.mode);
    // Already accepted events remain idempotent even after their freshness window.
    if (existing) return reply.code(responseStatus(existing)).send(existing);
    validateTimestamp(event.timestamp, now(), maxAge, futureSkew);
    const market = await adapter.getMarket(event.marketId);
    const raced = store.existingEvent(event.eventId, hash, adapter.mode);
    if (raced) return reply.code(responseStatus(raced)).send(raced);
    if (!market) throw new ResolverError(404, "MARKET_NOT_FOUND", "Registered market does not exist in the adapter");
    if (market.authority !== mapping.authority || market.resolverAuthority !== mapping.resolverAuthority ||
        market.resolverAuthority !== signer.publicKey.toBase58()) {
      throw new ResolverError(403, "MARKET_AUTHORITY_MISMATCH", "Market ownership or resolver authority does not match its registration");
    }
    if (market.status !== "closed" || now() < market.closesAt || event.timestamp < market.closesAt) {
      throw new ResolverError(422, "MARKET_INELIGIBLE", "Market must be closed and the result timestamp must be at or after its deadline");
    }
    const reservation = store.receive(event, hash, adapter.mode, now());
    if (!reservation.created) return reply.code(responseStatus(reservation.record)).send(reservation.record);
    store.updateEvent(event.eventId, "received", "processing", now());
    let record: EventRecord;
    try {
      const transaction = await adapter.resolveMarket(event.marketId, event.outcome, signer);
      record = store.updateEvent(event.eventId, "processing", transaction.status, now(), transaction,
        transaction.status === "failed" ? { code: "TRANSACTION_FAILED", message: "Resolution transaction failed" } : null);
    } catch (error) {
      const uncertain = error instanceof HunchError ? error.code === "TRANSACTION_UNCERTAIN" : adapter.mode === "anchor";
      const code = error instanceof HunchError ? error.code : uncertain ? "TRANSACTION_UNCERTAIN" : "RESOLUTION_FAILED";
      const message = error instanceof HunchError ? error.message : uncertain ? "Resolution outcome is uncertain; manual reconciliation is required" : "Resolution failed";
      // Never retry an uncertain or failed accepted event automatically in this MVP.
      record = store.updateEvent(event.eventId, "processing", uncertain ? "submitted" : "failed", now(), null, { code, message });
      app.log.error({ eventId: event.eventId, code }, "Resolution did not confirm");
      return reply.code(uncertain ? 202 : 502).send(record);
    }
    return reply.code(responseStatus(record)).send(record);
  });
  if (options.mockHttp) registerMockHttp(app, options.mockHttp, adapter, signer, store);
  return app;
}

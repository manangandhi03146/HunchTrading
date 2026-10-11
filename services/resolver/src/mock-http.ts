import { MockMarketAdapter } from "@hunch/sdk";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { HunchError, createMockWallet } from "@hunch/sdk";
import type { MarketAdapter, WalletSigner } from "@hunch/sdk";
import { z } from "zod";
import { identifier, ResolverError } from "./validation.js";
import type { ResolverStore } from "./store.js";

export const DEFAULT_MOCK_ORIGINS = [
  "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000",
  "http://127.0.0.1:3000", "http://localhost:4173", "http://127.0.0.1:4173",
];
export interface MockHttpOptions {
  /** Trusted server identity used for market creation; never supplied by HTTP clients. */
  creator: WalletSigner;
  access: "local" | "token";
  accessToken?: string;
  allowedOrigins?: readonly string[];
}
export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/.test(host);
}
export function isLoopbackAddress(address: string): boolean {
  return address === "::1" || /^127\./.test(address) || /^::ffff:127\./.test(address);
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ResolverError(400, "INVALID_INPUT", "Invalid mock request fields");
  return result.data;
}
const marketParams = z.strictObject({
  id: identifier.max(119).optional(), appId: identifier,
  question: z.string().trim().min(1).max(2000), outcomes: z.tuple([z.string().trim().min(1).max(200), z.string().trim().min(1).max(200)]),
  closesAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  description: z.string().max(4000).optional(), resolverAuthority: z.string().optional(),
});
const pathParams = z.object({ marketId: identifier });
const statuses = z.enum(["open", "closed", "resolved", "cancelled"]);
const errorStatuses: Partial<Record<HunchError["code"], number>> = {
  INVALID_INPUT: 400, INVALID_OUTCOME: 400, INVALID_AMOUNT: 400, INVALID_DEADLINE: 400,
  MARKET_NOT_FOUND: 404, MARKET_EXISTS: 409, UNAUTHORIZED: 403, WALLET_REQUIRED: 401,
  MARKET_CLOSED: 409, MARKET_NOT_CLOSED: 409, MARKET_RESOLVED: 409, MARKET_NOT_RESOLVED: 409,
  NO_WINNING_POSITION: 422, ALREADY_CLAIMED: 409,
};

/** Exact HTTP(S) origins only: no wildcards, paths, or credentials. */
export function validateOrigins(origins: readonly string[], loopbackOnly = false): string[] {
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { url = new URL("invalid:"); }
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || (loopbackOnly && !isLoopbackHost(url.hostname))) {
      throw new HunchError("CONFIGURATION_ERROR", loopbackOnly
        ? "Allowed origins must be exact HTTP(S) origins; local access requires loopback origins"
        : "Allowed origins must be exact HTTP(S) origins");
    }
  }
  return [...origins];
}

/** Validates mock access settings; returns the browser origins the mock API admits. */
export function mockHttpOrigins(options: MockHttpOptions, adapter: MarketAdapter): string[] {
  if (adapter.mode !== "mock") throw new HunchError("CONFIGURATION_ERROR", "Mock HTTP endpoints cannot be enabled for a real-chain adapter");
  if (options.access === "token" && (!options.accessToken || options.accessToken.length < 32)) {
    throw new HunchError("CONFIGURATION_ERROR", "Authenticated demo access requires MOCK_API_TOKEN of at least 32 characters");
  }
  return validateOrigins(options.allowedOrigins ?? DEFAULT_MOCK_ORIGINS, options.access === "local");
}

export const MOCK_CORS_HEADERS = ["Authorization", "X-Hunch-Mock-Session"];

/** The caller registers CORS once for the whole server (see buildServer). */
export function registerMockHttp(app: FastifyInstance, options: MockHttpOptions, adapter: MarketAdapter,
  signer: WalletSigner, store: ResolverStore): void {
  const origins = mockHttpOrigins(options, adapter);
  const sessions = new Map<string, { wallet: WalletSigner; label: string }>();
  const expectedToken = options.accessToken ? createHash("sha256").update(options.accessToken).digest() : null;
  function checkAccess(request: FastifyRequest): void {
    const origin = request.headers.origin;
    if (origin && !origins.includes(origin)) throw new ResolverError(403, "MOCK_ORIGIN_DENIED", "Frontend origin is not allowed");
    if (options.access === "local") {
      let host: string;
      try {
        const url = new URL(`http://${request.headers.host ?? ""}`);
        if (url.username || url.password || url.pathname !== "/") throw new Error();
        host = url.hostname;
      } catch { throw new ResolverError(403, "MOCK_LOCAL_ONLY", "Mock API requires a loopback host"); }
      if (!isLoopbackHost(host) || !isLoopbackAddress(request.ip)) {
        throw new ResolverError(403, "MOCK_LOCAL_ONLY", "Mock API is restricted to loopback clients");
      }
    } else {
      const auth = request.headers.authorization;
      const supplied = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!expectedToken || !timingSafeEqual(createHash("sha256").update(supplied).digest(), expectedToken)) {
        throw new ResolverError(401, "MOCK_ACCESS_DENIED", "A valid demo access token is required");
      }
    }
  }
  function identity(request: FastifyRequest): WalletSigner {
    const token = request.headers["x-hunch-mock-session"];
    const session = typeof token === "string" ? sessions.get(token) : undefined;
    if (!session) throw new ResolverError(401, "MOCK_SESSION_REQUIRED", "Use a server-issued simulated identity session");
    return session.wallet;
  }
  function send(reply: FastifyReply, value: object, status = 200) {
    reply.header("cache-control", "no-store");
    return reply.code(status).type("application/json").send(JSON.stringify({ ...value, mode: "mock", simulated: true },
      (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item));
  }
  const wrap = (handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      checkAccess(request);
      try { return await handler(request, reply); }
      catch (error) {
        if (error instanceof HunchError) throw new ResolverError(errorStatuses[error.code] ?? 500, error.code, error.message);
        throw error;
      }
    };

  // CORS is a browser transport policy; each actual route independently checks access.
  app.post("/v1/mock/sessions", wrap(async (request, reply) => {
    const { label } = parse(z.strictObject({ label: z.string().trim().min(1).max(80).default("Simulated player") }), request.body ?? {});
    if (sessions.size >= 1024) throw new ResolverError(503, "MOCK_SESSION_LIMIT", "Mock session limit reached; restart this development server");
    const wallet = createMockWallet(new PublicKey(randomBytes(32)));
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { wallet, label });
    return send(reply, { sessionToken: token, wallet: wallet.publicKey.toBase58(), label }, 201);
  }));
  app.get("/v1/mock/balance", wrap(async (request, reply) => {
    const actor = identity(request);
    if (!(adapter instanceof MockMarketAdapter)) throw new ResolverError(503, "BALANCE_UNAVAILABLE", "Demo balance source unavailable");
    return send(reply, { balance: adapter.getTokenBalance(actor.publicKey.toBase58()).toString() });
  }));
  app.get("/v1/mock/markets", wrap(async (request, reply) => {
    const query = parse(z.strictObject({ authority: z.string().optional(), status: statuses.optional() }), request.query);
    return send(reply, { markets: await adapter.listMarkets(query) });
  }));
  app.get("/v1/mock/markets/:marketId", wrap(async (request, reply) => {
    const { marketId } = parse(pathParams, request.params);
    return send(reply, { market: await adapter.getMarket(marketId) });
  }));
  app.post("/v1/mock/markets", wrap(async (request, reply) => {
    identity(request);
    const { appId, ...params } = parse(marketParams, request.body);
    if (!store.getApp(appId)?.enabled) throw new ResolverError(403, "UNKNOWN_APPLICATION", "Register and enable the application before creating its mock market");
    const marketId = params.id ?? randomUUID();
    if (store.getMarketMapping(marketId)) throw new ResolverError(409, "MARKET_EXISTS", "Market ID is already reserved; use a fresh ID after restarting mock state");
    const mapping = { appId, marketId, eventId: `${marketId}-finished`, authority: options.creator.publicKey.toBase58(), resolverAuthority: signer.publicKey.toBase58() };
    // Register before adapter creation; clean up this mapping if the adapter rejects input.
    store.registerMarket(mapping);
    try {
      const result = await adapter.createMarket({ ...params, id: marketId }, options.creator);
      return send(reply, { ...result, registration: mapping }, 201);
    } catch (error) {
      store.removeUnprocessedMarketMapping(marketId);
      throw error;
    }
  }));
  app.post("/v1/mock/markets/:marketId/predictions", wrap(async (request, reply) => {
    const actor = identity(request);
    const { marketId } = parse(pathParams, request.params);
    const data = parse(z.strictObject({ outcome: z.union([z.literal(0), z.literal(1)]), amount: z.string().max(128).regex(/^[1-9][0-9]*$/) }), request.body);
    return send(reply, await adapter.predict({ marketId, outcome: data.outcome, amount: BigInt(data.amount) }, actor));
  }));
  app.get("/v1/mock/markets/:marketId/positions", wrap(async (request, reply) => {
    const { marketId } = parse(pathParams, request.params);
    const { wallet } = parse(z.strictObject({ wallet: z.string().optional() }), request.query);
    // A read filter is not proof of ownership; mutation actor comes only from the session.
    return send(reply, { positions: await adapter.getPositions(marketId, wallet) });
  }));
  app.post("/v1/mock/markets/:marketId/claims", wrap(async (request, reply) => {
    const actor = identity(request);
    const { marketId } = parse(pathParams, request.params);
    parse(z.strictObject({}), request.body ?? {});
    return send(reply, await adapter.claimWinnings(marketId, actor));
  }));
  app.get("/v1/mock/transactions/:transactionId", wrap(async (request, reply) => {
    const { transactionId } = parse(z.object({ transactionId: identifier }), request.params);
    return send(reply, { transaction: await adapter.getTransactionStatus(transactionId) });
  }));
}

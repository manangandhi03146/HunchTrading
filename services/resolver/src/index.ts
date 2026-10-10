import { PublicKey } from "@solana/web3.js";
import { AnchorMarketAdapter, HUNCH_DEVNET_RESOLVER, HUNCH_DEVNET_TOKEN_MINT, HunchError, MockMarketAdapter, createMockWallet } from "@hunch/sdk";
import { buildServer } from "./server.js";
import { ResolverStore } from "./store.js";
import { loadConfig, splitList } from "./config.js";
import type { ResolverConfig } from "./config.js";
import { isLoopbackHost } from "./mock-http.js";
import { loadResolverSigner, validateRealMode } from "./real-mode.js";

function mockServer(config: ResolverConfig, store: ResolverStore) {
  const mockHttp = config.MOCK_HTTP_ENABLED ?? true;
  if (mockHttp && config.MOCK_HTTP_ACCESS === "local" && !isLoopbackHost(config.HOST)) {
    throw new Error("Local mock HTTP access requires a loopback HOST; remote demos must explicitly use token access");
  }
  const resolverKey = new PublicKey(config.RESOLVER_PUBLIC_KEY ?? new Uint8Array(32).fill(2));
  const creatorKey = new PublicKey(config.MOCK_CREATOR_PUBLIC_KEY ?? new Uint8Array(32).fill(1));
  const adapter = new MockMarketAdapter({ resolverAuthority: resolverKey.toBase58(), authorizedCreators: [creatorKey.toBase58()] });
  return buildServer({ adapter, signer: createMockWallet(resolverKey), store, corsOrigins: splitList(config.CORS_ALLOWED_ORIGINS),
    maxEventAgeSeconds: config.MAX_EVENT_AGE_SECONDS, maxFutureSkewSeconds: config.MAX_FUTURE_SKEW_SECONDS, logger: true,
    mockHttp: mockHttp ? { creator: createMockWallet(creatorKey), access: config.MOCK_HTTP_ACCESS,
      accessToken: config.MOCK_API_TOKEN, allowedOrigins: config.MOCK_ALLOWED_ORIGINS ? splitList(config.MOCK_ALLOWED_ORIGINS) : undefined } : undefined });
}

/** Validates everything local (no RPC) before touching the network or opening the database. */
function realModeSigner(config: ResolverConfig) {
  if (config.MOCK_HTTP_ENABLED === true) {
    throw new HunchError("CONFIGURATION_ERROR", "Mock HTTP endpoints cannot run in real mode; set MOCK_HTTP_ENABLED=false or leave it unset");
  }
  if (config.RESOLVER_PUBLIC_KEY && config.RESOLVER_PUBKEY && config.RESOLVER_PUBLIC_KEY !== config.RESOLVER_PUBKEY) {
    throw new HunchError("CONFIGURATION_ERROR", "RESOLVER_PUBLIC_KEY and RESOLVER_PUBKEY disagree");
  }
  const expectedPublicKey = config.RESOLVER_PUBLIC_KEY ?? config.RESOLVER_PUBKEY ?? HUNCH_DEVNET_RESOLVER;
  return loadResolverSigner(config.RESOLVER_KEYPAIR_PATH, { expectedPublicKey });
}

async function main() {
  const config = loadConfig();
  if (config.RESOLVER_MODE === "anchor") {
    const signer = realModeSigner(config);
    const tokenMint = config.TEST_TOKEN_MINT ?? HUNCH_DEVNET_TOKEN_MINT;
    // The adapter only accepts this signer for resolution; prediction wallets are refused.
    const adapter = new AnchorMarketAdapter({ rpcUrl: config.SOLANA_RPC_URL, programId: config.HUNCH_PROGRAM_ID, tokenMint,
      resolverAuthority: signer.publicKey.toBase58() });
    const status = await validateRealMode(adapter, signer, tokenMint);
    const store = new ResolverStore(config.RESOLVER_DB_PATH);
    const server = buildServer({ adapter, signer, store, tokenMint, corsOrigins: splitList(config.CORS_ALLOWED_ORIGINS),
      maxEventAgeSeconds: config.MAX_EVENT_AGE_SECONDS, maxFutureSkewSeconds: config.MAX_FUTURE_SKEW_SECONDS, logger: true });
    await start(server, store, config);
    server.log.info(status, "Real Devnet resolver mode: mock endpoints disabled; resolutions are signed transactions");
    if (status.resolverLamports === 0) server.log.warn("Resolver has 0 SOL; resolutions will fail with INSUFFICIENT_FUNDS until it is funded");
    const unsettled = store.unsettledEvents().filter((event) => event.mode === "anchor");
    if (unsettled.length) {
      server.log.warn({ events: unsettled.map((event) => event.eventId) }, "Events await reconciliation; run npm run reconcile before any retry");
    }
    return;
  }
  const store = new ResolverStore(config.RESOLVER_DB_PATH);
  let server;
  try { server = mockServer(config, store); }
  catch (error) { store.close(); throw error; }
  await start(server, store, config);
  if (config.MOCK_HTTP_ENABLED ?? true) server.log.info("Resolver owns mock state. Connect frontend HTTP adapters to /v1/mock; identities and receipts are simulated.");
}

async function start(server: ReturnType<typeof buildServer>, store: ResolverStore, config: ResolverConfig) {
  server.addHook("onClose", async () => store.close());
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { void server.close().catch(() => { process.exitCode = 1; }); });
  }
  try {
    await server.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    await server.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  // Messages only: never print causes, which may carry RPC URLs or file paths.
  console.error(error instanceof Error ? error.message : "Resolver startup failed");
  process.exitCode = 1;
});

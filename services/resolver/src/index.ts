import { PublicKey } from "@solana/web3.js";
import { AnchorMarketAdapter, MockMarketAdapter, createMockWallet } from "@hunch/sdk";
import { buildServer } from "./server.js";
import { ResolverStore } from "./store.js";
import { loadConfig } from "./config.js";
import { isLoopbackHost } from "./mock-http.js";

async function main() {
  const config = loadConfig();
  // Real mode fails before reading any key until Developer A supplies the IDL.
  if (config.RESOLVER_MODE === "anchor") new AnchorMarketAdapter({ rpcUrl: config.SOLANA_RPC_URL, programId: config.HUNCH_PROGRAM_ID });
  if (config.MOCK_HTTP_ENABLED && config.MOCK_HTTP_ACCESS === "local" && !isLoopbackHost(config.HOST)) {
    throw new Error("Local mock HTTP access requires a loopback HOST; remote demos must explicitly use token access");
  }
  const resolverKey = new PublicKey(config.RESOLVER_PUBLIC_KEY ?? new Uint8Array(32).fill(2));
  const creatorKey = new PublicKey(config.MOCK_CREATOR_PUBLIC_KEY ?? new Uint8Array(32).fill(1));
  const adapter = new MockMarketAdapter({ resolverAuthority: resolverKey.toBase58(), authorizedCreators: [creatorKey.toBase58()] });
  const store = new ResolverStore(config.RESOLVER_DB_PATH);
  const server = buildServer({ adapter, signer: createMockWallet(resolverKey), store,
    maxEventAgeSeconds: config.MAX_EVENT_AGE_SECONDS, maxFutureSkewSeconds: config.MAX_FUTURE_SKEW_SECONDS, logger: true,
    mockHttp: config.MOCK_HTTP_ENABLED ? { creator: createMockWallet(creatorKey), access: config.MOCK_HTTP_ACCESS,
      accessToken: config.MOCK_API_TOKEN, allowedOrigins: config.MOCK_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) } : undefined });
  server.addHook("onClose", async () => store.close());
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { void server.close().catch(() => { process.exitCode = 1; }); });
  }
  try {
    await server.listen({ port: config.PORT, host: config.HOST });
    server.log.info("Resolver owns mock state. Connect frontend HTTP adapters to /v1/mock; identities and receipts are simulated.");
  } catch (error) {
    await server.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Resolver startup failed");
  process.exitCode = 1;
});

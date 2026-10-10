import { resolve } from "node:path";
import { config } from "dotenv";
import { z } from "zod";

export function loadConfig() {
  config({ path: process.env.ENV_FILE ?? resolve(import.meta.dirname, "../../../.env") });
  return z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().default("127.0.0.1"),
    RESOLVER_MODE: z.enum(["mock", "anchor"]).default("mock"),
    RESOLVER_DB_PATH: z.string().default(resolve(import.meta.dirname, "../../../.data/resolver.sqlite")),
    RESOLVER_PUBLIC_KEY: z.string().optional(),
    MOCK_CREATOR_PUBLIC_KEY: z.string().optional(),
    MOCK_HTTP_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
    MOCK_HTTP_ACCESS: z.enum(["local", "token"]).default("local"),
    MOCK_API_TOKEN: z.string().optional(),
    MOCK_ALLOWED_ORIGINS: z.string().optional(),
    SOLANA_RPC_URL: z.url().default("https://api.devnet.solana.com"),
    HUNCH_PROGRAM_ID: z.string().optional(),
    MAX_EVENT_AGE_SECONDS: z.coerce.number().int().nonnegative().default(300),
    MAX_FUTURE_SKEW_SECONDS: z.coerce.number().int().nonnegative().default(30),
  }).parse(process.env);
}

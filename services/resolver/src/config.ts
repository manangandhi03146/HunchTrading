import { resolve } from "node:path";
import { config } from "dotenv";
import { z } from "zod";

const optionalKey = z.string().trim().min(1).optional();

export function loadConfig() {
  config({ path: process.env.ENV_FILE ?? resolve(import.meta.dirname, "../../../.env") });
  return z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().default("127.0.0.1"),
    RESOLVER_MODE: z.enum(["mock", "anchor"]).default("mock"),
    RESOLVER_DB_PATH: z.string().default(resolve(import.meta.dirname, "../../../.data/resolver.sqlite")),
    // Mock mode: simulated resolver identity. Anchor mode: expected resolver authority (alias RESOLVER_PUBKEY).
    RESOLVER_PUBLIC_KEY: optionalKey,
    RESOLVER_PUBKEY: optionalKey,
    // Anchor mode only: server-side Solana keypair file outside the repository.
    RESOLVER_KEYPAIR_PATH: optionalKey,
    MOCK_CREATOR_PUBLIC_KEY: optionalKey,
    // Unset means enabled in mock mode and disabled in anchor mode; "true" is rejected in anchor mode.
    MOCK_HTTP_ENABLED: z.enum(["true", "false"]).optional().transform((value) => value === undefined ? undefined : value === "true"),
    MOCK_HTTP_ACCESS: z.enum(["local", "token"]).default("local"),
    MOCK_API_TOKEN: z.string().optional(),
    MOCK_ALLOWED_ORIGINS: z.string().optional(),
    // Exact browser origins allowed to read event status in either mode.
    CORS_ALLOWED_ORIGINS: z.string().optional(),
    SOLANA_RPC_URL: z.url().default("https://api.devnet.solana.com"),
    HUNCH_PROGRAM_ID: optionalKey,
    TEST_TOKEN_MINT: optionalKey,
    MAX_EVENT_AGE_SECONDS: z.coerce.number().int().nonnegative().default(300),
    MAX_FUTURE_SKEW_SECONDS: z.coerce.number().int().nonnegative().default(30),
  // Blank entries (e.g. `RESOLVER_PUBKEY=`) mean unset rather than invalid.
  }).parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== "")));
}
export type ResolverConfig = ReturnType<typeof loadConfig>;

export const splitList = (value: string | undefined) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];

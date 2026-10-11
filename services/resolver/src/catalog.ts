import nacl from "tweetnacl";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import type { FastifyInstance } from "fastify";
import type { MarketAdapter } from "@hunch/sdk";
import type { ResolverStore } from "./store.js";

const metadata = z.object({ marketId: z.string().min(32).max(44), question: z.string().trim().min(1).max(2000), outcomes: z.tuple([z.string().trim().min(1).max(200), z.string().trim().min(1).max(200)]).refine(v => v[0].toLowerCase() !== v[1].toLowerCase()), description: z.string().trim().max(4000).optional() });
/** Off-chain labels require an authority signature; pools and outcomes always come from chain. */
export function registerCatalog(server: FastifyInstance, adapter: MarketAdapter, store: ResolverStore) {
  server.get("/v1/metadata", async () => ({ metadata: store.listMetadata() }));
  server.post("/v1/metadata", async (request, reply) => {
    if (adapter.mode !== "anchor") return reply.code(409).send({ error: "Metadata publishing is for live Devnet markets." });
    const parsed = z.object({ metadata, signature: z.string().max(100) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid metadata payload." });
    const m = parsed.data.metadata;
    let market;
    try { new PublicKey(m.marketId); market = await adapter.getMarket(m.marketId); }
    catch { return reply.code(503).send({ error: "Cannot verify market authority on Devnet." }); }
    if (!market) return reply.code(404).send({ error: "Market not found on Devnet." });
    const payload = new TextEncoder().encode(`hunch:market-metadata:v1\n${JSON.stringify(m)}`);
    let valid = false;
    try { valid = nacl.sign.detached.verify(payload, Buffer.from(parsed.data.signature, "base64"), new PublicKey(market.authority).toBytes()); } catch { /* Invalid signature. */ }
    if (!valid) return reply.code(403).send({ error: "Market authority signature required." });
    const existing = store.listMetadata().find(item => item.marketId === m.marketId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(m)) return reply.code(409).send({ error: "Published question and outcomes are immutable." });
    store.saveMetadata(m);
    return { metadata: m };
  });
}

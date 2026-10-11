/** Local shared demonstration, not a deployment or real resolver key. */
import { PublicKey } from "@solana/web3.js";
import { MockMarketAdapter, createMockWallet } from "@hunch/sdk";
import nacl from "tweetnacl";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildServer } from "./server.js";
import { ResolverStore } from "./store.js";
import { signGameEvent } from "./signing.js";
import { isLoopbackHost, isLoopbackAddress } from "./mock-http.js";
const resolver = createMockWallet(new PublicKey(new Uint8Array(32).fill(2)));
const creator = createMockWallet(new PublicKey(new Uint8Array(32).fill(1)));
const adapter = new MockMarketAdapter({ resolverAuthority: resolver.publicKey.toBase58(), authorizedCreators: [creator.publicKey.toBase58()], initialBalance: 1000n });
const store = new ResolverStore(":memory:");
// This demonstration app has an ephemeral game-event public key. Its secret is never exposed.
const keyPath = process.env.SHARED_DEMO_GAME_KEYPAIR_PATH;
const eventKey = keyPath ? nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(keyPath), "utf8")))) : nacl.sign.keyPair();
store.registerApp({ appId: "hunch-web", publicKey: Buffer.from(eventKey.publicKey).toString("base64"), enabled: true });
for (const [id, question, a, b] of [
  ["race-42", "Who takes the checkered flag?", "Apex", "Velocity"],
  ["nova-titan", "Who wins Nova vs Titan?", "Nova", "Titan"],
  ["orbit-echo", "Who wins Orbit vs Echo?", "Orbit", "Echo"],
  ["zenith-pulse", "Who wins Zenith vs Pulse?", "Zenith", "Pulse"],
] as const) {
  await adapter.createMarket({ id, question, outcomes: [a, b], closesAt: Math.floor(Date.now() / 1000) + (id === "race-42" ? 120 : 3600) }, creator);
  store.registerMarket({ appId: "hunch-web", marketId: id, eventId: `${id}-finished`, authority: creator.publicKey.toBase58(), resolverAuthority: resolver.publicKey.toBase58() });
}
const server = buildServer({ adapter, signer: resolver, store, logger: true, mockHttp: { creator, access: "local", allowedOrigins: ["http://127.0.0.1:5175", "http://localhost:5175", "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:3000", "http://localhost:3000"] } });
let race: { marketId: string; status: "upcoming" | "racing" | "finished"; durationMs: number; startedAt?: number; winner: 0 | null; simulated: true } = { marketId: "race-42", status: "upcoming", durationMs: 12000, winner: null, simulated: true };
let timer: ReturnType<typeof setTimeout> | undefined;
server.get("/v1/mock/races/race-42", async () => race);
server.post("/v1/mock/races/race-42/start", async (request, reply) => {
  const allowed = ["http://127.0.0.1:5175", "http://localhost:5175", "http://127.0.0.1:3000", "http://localhost:3000"];
  if (!isLoopbackAddress(request.ip) || !isLoopbackHost(new URL(`http://${request.headers.host}`).hostname) || (request.headers.origin && !allowed.includes(request.headers.origin))) return reply.code(403).send({ error: "This game is a local shared fixture." });
  if (race.status !== "upcoming") return race;
  if ((await adapter.getMarket("race-42"))?.status !== "closed") return reply.code(409).send({ error: "Predictions must close before the shared race starts." });
  race = { ...race, status: "racing", startedAt: Date.now() };
  // Fixed demonstration result from the trusted server, never a browser-supplied outcome.
  timer = setTimeout(() => {
    void (async () => {
      const event = signGameEvent({ appId: "hunch-web", eventId: "race-42-finished", marketId: "race-42", outcome: 0, timestamp: Math.floor(Date.now() / 1000) }, eventKey.secretKey);
      const response = await server.inject({ method: "POST", url: "/v1/events", payload: event });
      if (response.statusCode === 200) race = { ...race, status: "finished", winner: 0 };
      else server.log.error("Shared race result was rejected. Inspect the event record before retrying.");
    })().catch(() => server.log.error("Shared race resolution needs reconciliation."));
  }, race.durationMs);
  return race;
});
server.addHook("onClose", async () => { if (timer) clearTimeout(timer); });
server.addHook("onClose", async () => store.close());
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void server.close(); });
await server.listen({ host: "127.0.0.1", port: 8787 });
console.log("Shared local demo ready. Each browser gets its own 1,000-credit identity; ledger resets on restart.");

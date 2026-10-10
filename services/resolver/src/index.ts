/**
 * hunch resolver service (plan §3, Developer B — tickets B5/B6).
 *
 * Flow:
 *   game server signs canonical result -> POST /events
 *   -> verify signature -> check market+event+deadline
 *   -> resolver key signs Solana tx -> contract stores winning outcome
 *
 * Security rules (do not weaken):
 *   - Replay protection via unique eventId stored by the backend.
 *   - Only accept events from public keys registered to that developer app.
 *   - Validate market mapping + authoritative timestamp.
 *   - Never trust a client-supplied winner directly; a signed event is
 *     EVIDENCE accepted by hunch, not authorization to move funds.
 */
import express from "express";
import type { GameResultEvent } from "@hunch/sdk";

const app = express();
app.use(express.json());

// Replace with a durable store for a real deployment.
const seenEventIds = new Set<string>();
// publicKey -> developer app id. Populate from your registry.
const registeredKeys = new Map<string, string>();

function verifySignature(_event: GameResultEvent): boolean {
  // TODO(B5): ed25519 verify over the canonical payload using tweetnacl.
  // Return false until implemented so we never resolve on unverified input.
  return false;
}

app.post("/events", async (req, res) => {
  const event = req.body as GameResultEvent;

  if (!event?.eventId || !event.marketId || !event.publicKey) {
    return res.status(400).json({ error: "missing required fields" });
  }
  if (seenEventIds.has(event.eventId)) {
    return res.status(409).json({ error: "replay: eventId already processed" });
  }
  if (!registeredKeys.has(event.publicKey)) {
    return res.status(403).json({ error: "unregistered public key" });
  }
  if (!verifySignature(event)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  // TODO(B6): validate market exists, outcome is 0|1, deadline passed,
  // then call hunch.resolveMarket(...) with the resolver keypair and
  // return the REAL transaction signature.
  seenEventIds.add(event.eventId);
  return res.status(501).json({ error: "resolve_market wiring pending (B6)" });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`[resolver] listening on :${PORT}`));

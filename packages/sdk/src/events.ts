import type { GameEventPayload } from "./types.js";

/** Exact v1 bytes signed by the registered application's trusted backend. */
export function canonicalEventPayload(event: GameEventPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([
    "hunch:event:v1", event.appId, event.eventId, event.marketId, event.outcome, event.timestamp,
  ]));
}

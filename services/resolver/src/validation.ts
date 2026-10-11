import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import { z } from "zod";
import { canonicalEventPayload } from "@hunch/sdk";
import type { SignedGameEvent } from "@hunch/sdk";

export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const eventSchema = z.strictObject({
  appId: identifier,
  eventId: identifier,
  marketId: identifier,
  outcome: z.union([z.literal(0), z.literal(1)]),
  timestamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  signature: z.string().length(88),
});

export class ResolverError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

/** Buffer.from alone accepts malformed base64; re-encoding must match exactly. */
export function decodeBase64(value: string, length: number): Uint8Array | null {
  const bytes = Buffer.from(value, "base64");
  return bytes.length === length && bytes.toString("base64") === value ? bytes : null;
}

export function verifyEventSignature(event: SignedGameEvent, publicKey: string): boolean {
  const key = decodeBase64(publicKey, nacl.sign.publicKeyLength);
  const signature = decodeBase64(event.signature, nacl.sign.signatureLength);
  return Boolean(key && signature && nacl.sign.detached.verify(canonicalEventPayload(event), signature, key));
}

export function payloadHash(event: SignedGameEvent): string {
  return createHash("sha256").update(canonicalEventPayload(event)).digest("hex");
}

export function validateTimestamp(timestamp: number, now: number, maxAge: number, futureSkew: number): void {
  if (timestamp < now - maxAge) throw new ResolverError(400, "EVENT_EXPIRED", "Signed event is too old");
  if (timestamp > now + futureSkew) throw new ResolverError(400, "EVENT_IN_FUTURE", "Signed event timestamp is too far in the future");
}

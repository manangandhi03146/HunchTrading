import nacl from "tweetnacl";
import { canonicalEventPayload } from "@hunch/sdk";
import type { GameEventPayload, SignedGameEvent } from "@hunch/sdk";

/** Server-side helper. Never send the secret key to a frontend. */
export function signGameEvent(payload: GameEventPayload, secretKey: Uint8Array): SignedGameEvent {
  if (secretKey.length !== nacl.sign.secretKeyLength) throw new Error("Application signing key must contain 64 bytes");
  const derived = nacl.sign.keyPair.fromSeed(secretKey.subarray(0, 32));
  if (!Buffer.from(derived.secretKey).equals(Buffer.from(secretKey))) throw new Error("Application signing key is inconsistent");
  return { ...payload, signature: Buffer.from(nacl.sign.detached(canonicalEventPayload(payload), secretKey)).toString("base64") };
}

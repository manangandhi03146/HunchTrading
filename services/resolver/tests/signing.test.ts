import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { signGameEvent } from "../src/signing.js";
import { verifyEventSignature, decodeBase64 } from "../src/validation.js";

const payload = { appId: "racing-demo", marketId: "race-42", eventId: "race-42-finished", outcome: 0 as const, timestamp: 1100 };
const keys = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(6));

describe("developer event signing", () => {
  it("produces a valid deterministic signature without mutating the payload", () => {
    const event = signGameEvent(payload, keys.secretKey);
    expect(verifyEventSignature(event, Buffer.from(keys.publicKey).toString("base64"))).toBe(true);
    expect(signGameEvent(payload, keys.secretKey)).toEqual(event);
    expect(payload).not.toHaveProperty("signature");
  });
  it("rejects a truncated key", () => {
    expect(() => signGameEvent(payload, keys.secretKey.subarray(0, 32))).toThrow(/64 bytes/);
  });
  it("rejects inconsistent key material", () => {
    const key = keys.secretKey.slice();
    key[63] ^= 1;
    expect(() => signGameEvent(payload, key)).toThrow(/inconsistent/);
  });
  it("requires canonical base64 and exact decoded lengths", () => {
    const encoded = Buffer.from(keys.publicKey).toString("base64");
    expect(decodeBase64(encoded, 32)).toEqual(Buffer.from(keys.publicKey));
    expect(decodeBase64(encoded + "\n", 32)).toBeNull();
    expect(decodeBase64(encoded, 64)).toBeNull();
  });
});

import { expect, it } from "vitest";
import { runMockDemo } from "../src/demo-flow.js";

it("creates, predicts, signs, submits through Fastify, resolves and claims for racing and esports", async () => {
  const result = await runMockDemo();
  expect(result.mode).toBe("mock");
  expect(result.signatureVerification).toBe("Ed25519");
  expect(result.scenarios).toHaveLength(2);
  expect(result.scenarios.every((scenario) => scenario.status === "confirmed" && scenario.payout === "100" && scenario.signature === null)).toBe(true);
});

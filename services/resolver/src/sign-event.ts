import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { eventSchema } from "./validation.js";
import { signGameEvent } from "./signing.js";

try {
  const { values } = parseArgs({ options: {
    "keypair-path": { type: "string" }, "app-id": { type: "string" },
    "event-id": { type: "string" }, "market-id": { type: "string" },
    outcome: { type: "string" }, timestamp: { type: "string" },
  } });
  if (!values["keypair-path"]) throw new Error("--keypair-path must point to the trusted application's private key file");
  if (values.outcome !== "0" && values.outcome !== "1") throw new Error("--outcome must be 0 or 1");
  const payload = eventSchema.omit({ signature: true }).parse({
    appId: values["app-id"], eventId: values["event-id"], marketId: values["market-id"],
    outcome: Number(values.outcome), timestamp: values.timestamp === undefined ? Math.floor(Date.now() / 1000) : Number(values.timestamp),
  });
  const key = z.array(z.number().int().min(0).max(255)).length(64).parse(JSON.parse(readFileSync(values["keypair-path"], "utf8")));
  console.log(JSON.stringify(signGameEvent(payload, Uint8Array.from(key))));
} catch (error) {
  // Validation errors for key arrays may include input details; never print them.
  console.error(error instanceof z.ZodError || error instanceof SyntaxError ? "Invalid event arguments or private key file" : error instanceof Error ? error.message : "Event signing failed");
  process.exitCode = 1;
}

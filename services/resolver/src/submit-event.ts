import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eventSchema } from "./validation.js";

async function main() {
  const { values } = parseArgs({ options: { "event-file": { type: "string" }, url: { type: "string", default: "http://127.0.0.1:8787" } } });
  if (!values["event-file"]) throw new Error("--event-file is required");
  const event = eventSchema.parse(JSON.parse(readFileSync(values["event-file"], "utf8")));
  const response = await fetch(`${values.url!.replace(/\/$/, "")}/v1/events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(30_000),
  });
  console.log(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
}
main().catch(() => { console.error("Event submission failed; check the event file and resolver URL"); process.exitCode = 1; });

import { parseArgs } from "node:util";
import { ResolverStore } from "./store.js";
import { loadConfig } from "./config.js";

try {
  const { values } = parseArgs({ options: {
    "app-id": { type: "string" }, "public-key": { type: "string" },
    "market-id": { type: "string" }, "event-id": { type: "string" },
    authority: { type: "string" }, "resolver-authority": { type: "string" },
    disable: { type: "boolean", default: false },
  } });
  if (!values["app-id"]) throw new Error("--app-id is required");
  const config = loadConfig();
  const store = new ResolverStore(config.RESOLVER_DB_PATH);
  try {
    if (values["public-key"]) store.registerApp({ appId: values["app-id"], publicKey: values["public-key"], enabled: !values.disable });
    if (values["market-id"]) {
      if (!values["event-id"] || !values.authority || !values["resolver-authority"]) {
        throw new Error("Market registration requires --event-id, --authority and --resolver-authority");
      }
      store.registerMarket({ appId: values["app-id"], marketId: values["market-id"], eventId: values["event-id"], authority: values.authority, resolverAuthority: values["resolver-authority"] });
    }
    if (!values["public-key"] && !values["market-id"]) throw new Error("Provide --public-key to register an app, or --market-id to register a market");
    console.log("Registration saved to SQLite");
  } finally { store.close(); }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Registration failed");
  process.exitCode = 1;
}

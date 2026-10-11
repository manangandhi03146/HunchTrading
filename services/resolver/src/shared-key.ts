import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import nacl from "tweetnacl";
const path = resolve(process.env.SHARED_DEMO_GAME_KEYPAIR_PATH ?? "../../.data/shared-demo-game-keypair.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(Array.from(nacl.sign.keyPair().secretKey)), { flag: "wx", mode: 0o600 });
if (process.platform === "win32") {
  const identity = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${identity}:(F)`], { stdio: "ignore" });
}
console.log("New local simulated game-event key created with owner-only access. Existing files are never overwritten.");

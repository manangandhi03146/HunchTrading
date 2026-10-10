import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";

// Spawns the real entrypoint. Every case fails before listening; none reaches a public network.
const directory = mkdtempSync(join(tmpdir(), "hunch-startup-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const keys = Keypair.generate();
function keyFile(name: string, mode = 0o600) {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(Array.from(keys.secretKey))); chmodSync(path, mode);
  return path;
}
function start(env: Record<string, string>) {
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/index.ts", import.meta.url))], {
    // Unreachable local RPC: if validation ever got that far it fails without leaving this host.
    env: { ...process.env, RESOLVER_DB_PATH: ":memory:", ENV_FILE: "/nonexistent/hunch-startup-test.env", SOLANA_RPC_URL: "http://127.0.0.1:9",
      RESOLVER_MODE: "anchor", RESOLVER_PUBLIC_KEY: keys.publicKey.toBase58(), RESOLVER_KEYPAIR_PATH: "", MOCK_HTTP_ENABLED: "", RESOLVER_PUBKEY: "", ...env },
    encoding: "utf8", timeout: 15000,
  });
  return result;
}
const secretFragment = Array.from(keys.secretKey.slice(0, 6)).join(",");

describe("real-mode startup validation", () => {
  it("requires a resolver keypair path and never falls through to mock mode", () => {
    const result = start({});
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("RESOLVER_KEYPAIR_PATH");
    expect(result.stdout).not.toContain("Resolver owns mock state");
  });

  it("refuses to enable mock endpoints in real mode", () => {
    const result = start({ MOCK_HTTP_ENABLED: "true", RESOLVER_KEYPAIR_PATH: keyFile("mock.json") });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Mock HTTP endpoints cannot run in real mode");
  });

  it("refuses relative, inside-repository, and group-readable key paths", () => {
    expect(start({ RESOLVER_KEYPAIR_PATH: "resolver.json" }).stderr).toContain("absolute");
    const repositoryFile = fileURLToPath(new URL("../package.json", import.meta.url));
    expect(start({ RESOLVER_KEYPAIR_PATH: repositoryFile }).stderr).toContain("outside the repository");
    if (process.platform !== "win32") expect(start({ RESOLVER_KEYPAIR_PATH: keyFile("open.json", 0o644) }).stderr).toContain("chmod 600");
  });

  it("refuses a keypair that does not match the configured resolver", () => {
    const result = start({ RESOLVER_KEYPAIR_PATH: keyFile("mismatch.json"), RESOLVER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58() });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match the configured resolver authority");
    expect(result.stderr + result.stdout).not.toContain(secretFragment);
  });

  it("refuses conflicting resolver public key settings", () => {
    const result = start({ RESOLVER_KEYPAIR_PATH: keyFile("conflict.json"), RESOLVER_PUBKEY: Keypair.generate().publicKey.toBase58() });
    expect(result.stderr).toContain("disagree");
  });

  it("validates the chain before listening and fails closed when RPC is unreachable", () => {
    const result = start({ RESOLVER_KEYPAIR_PATH: keyFile("valid.json") });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Devnet RPC is unavailable");
    expect(result.stdout).not.toContain("Server listening");
    expect(result.stderr + result.stdout).not.toContain(secretFragment);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import { MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AnchorMarketAdapter, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_PROGRAM_ID } from "@hunch/sdk";
import { loadResolverSigner, validateRealMode } from "../src/real-mode.js";

// Ephemeral keys in temporary directories outside the repository; never printed.
let directory: string, keys: Keypair;
const write = (name: string, content: string, mode = 0o600) => { const path = join(directory, name); writeFileSync(path, content); chmodSync(path, mode); return path; };
const keyFile = (name = "resolver.json", keypair = keys, mode = 0o600) => write(name, JSON.stringify(Array.from(keypair.secretKey)), mode);
const load = (path: string | undefined, expected = keys.publicKey.toBase58(), repositoryRoot?: string) =>
  loadResolverSigner(path, { expectedPublicKey: expected, repositoryRoot });

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "hunch-resolver-key-")); keys = Keypair.generate(); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("server-side resolver key loading", () => {
  it("loads a private keypair file outside the repository and signs transactions", async () => {
    const signer = load(keyFile());
    expect(signer.publicKey.equals(keys.publicKey)).toBe(true);
    const tx = new Transaction({ feePayer: keys.publicKey, blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 })
      .add(SystemProgram.transfer({ fromPubkey: keys.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
    expect((await signer.signTransaction(tx)).verifySignatures()).toBe(true);
  });

  it("never exposes the secret key through serialization", () => {
    const signer = load(keyFile());
    const serialized = JSON.stringify(signer) + JSON.stringify(Object.entries(signer));
    expect(JSON.parse(JSON.stringify(signer))).toEqual({ publicKey: keys.publicKey.toBase58() });
    expect(serialized).not.toContain(String(keys.secretKey.slice(0, 8)));
    expect(Object.isFrozen(signer)).toBe(true);
  });

  it("expands ~/ paths from the home directory", () => {
    const original = process.env.HOME;
    process.env.HOME = directory;
    try { expect(load(`~/${keyFile().split("/").pop()}`).publicKey.equals(keys.publicKey)).toBe(true); }
    finally { process.env.HOME = original; }
  });

  it("requires a configured, absolute path", () => {
    expect(() => load(undefined)).toThrow(/RESOLVER_KEYPAIR_PATH/);
    expect(() => load("resolver.json")).toThrow(/absolute/);
    expect(() => load(join(directory, "missing.json"))).toThrow(/does not exist/);
    expect(() => load(directory)).toThrow(/regular file/);
  });

  it("refuses key files inside the repository, including through symlinks", () => {
    const repository = join(directory, "repo");
    mkdirSync(repository);
    const inside = join(repository, "resolver.json");
    writeFileSync(inside, JSON.stringify(Array.from(keys.secretKey))); chmodSync(inside, 0o600);
    expect(() => load(inside, undefined, repository)).toThrow(/outside the repository/);
    const link = join(directory, "link.json");
    symlinkSync(inside, link);
    expect(() => load(link, undefined, repository)).toThrow(/outside the repository/);
  });

  it.skipIf(process.platform === "win32")("refuses key files readable by group or others", () => {
    expect(() => load(keyFile("open.json", keys, 0o644))).toThrow(/chmod 600/);
    expect(() => load(keyFile("group.json", keys, 0o640))).toThrow(/chmod 600/);
  });

  it.each([["not JSON", "{"], ["wrong length", "[1,2,3]"], ["out of range", JSON.stringify(Array(64).fill(256))], ["object", "{\"secretKey\":[]}"]])("rejects a %s keypair without echoing its contents", (_label, content) => {
    const error = (() => { try { load(write("bad.json", content)); } catch (caught) { return caught as Error; } })();
    expect(error?.message).toMatch(/not a valid 64-byte Solana keypair/);
    expect(error?.message).not.toContain(content);
  });

  it("rejects an inconsistent secret/public key pair", () => {
    const bytes = Array.from(keys.secretKey); bytes[40] ^= 1;
    expect(() => load(write("tampered.json", JSON.stringify(bytes)))).toThrow(/not a valid/);
  });

  it("requires the keypair to match the configured resolver authority", () => {
    const other = Keypair.generate().publicKey.toBase58();
    const error = (() => { try { load(keyFile(), other); } catch (caught) { return caught as Error & { details?: Record<string, unknown> }; } })();
    expect(error).toMatchObject({ code: "CONFIGURATION_ERROR", details: { expected: other, actual: keys.publicKey.toBase58() } });
    expect(JSON.stringify(error?.details)).not.toContain(String(keys.secretKey[0]) + "," + String(keys.secretKey[1]));
    expect(() => load(keyFile(), "not-a-key")).toThrow(/invalid/);
  });
});

describe("read-only real-mode startup validation", () => {
  const program = new PublicKey(HUNCH_PROGRAM_ID), mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT);
  let connection: Connection, accounts: (AccountInfo<Buffer> | null)[];
  function mintInfo(isInitialized = true) {
    const data = Buffer.alloc(MintLayout.span);
    MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: SystemProgram.programId, supply: 1n, decimals: 0, isInitialized, freezeAuthorityOption: 0, freezeAuthority: SystemProgram.programId }, data);
    return { data, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0 };
  }
  beforeEach(() => {
    connection = new Connection("http://127.0.0.1:8899");
    accounts = [{ data: Buffer.alloc(0), owner: SystemProgram.programId, executable: true, lamports: 1, rentEpoch: 0 }, mintInfo()];
    vi.spyOn(connection, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
    vi.spyOn(connection, "getMultipleAccountsInfo").mockImplementation(async () => accounts);
    vi.spyOn(connection, "getBalance").mockResolvedValue(42);
  });
  const validate = () => validateRealMode(new AnchorMarketAdapter({ connection, resolverAuthority: keys.publicKey.toBase58() }), load(keyFile()), mint.toBase58());

  it("checks Devnet, the deployed program, the mint, and reports resolver SOL", async () => {
    expect(await validate()).toEqual({ resolver: keys.publicKey.toBase58(), resolverLamports: 42, programId: program.toBase58(), tokenMint: mint.toBase58() });
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledWith([program, mint], "confirmed");
  });
  it("refuses other clusters", async () => {
    vi.mocked(connection.getGenesisHash).mockResolvedValue("mainnet");
    await expect(validate()).rejects.toThrow(/restricted to Solana Devnet/);
  });
  it("refuses a missing program or invalid mint", async () => {
    accounts = [null, mintInfo()];
    await expect(validate()).rejects.toThrow(/not deployed/);
    accounts = [{ ...accounts[0]!, executable: true } as AccountInfo<Buffer>, mintInfo(false)];
    accounts[0] = { data: Buffer.alloc(0), owner: SystemProgram.programId, executable: true, lamports: 1, rentEpoch: 0 };
    await expect(validate()).rejects.toThrow(/classic SPL mint/);
  });
  it("reports RPC failures without leaking the endpoint", async () => {
    vi.mocked(connection.getGenesisHash).mockRejectedValue(new Error("https://rpc.example/?api-key=secret"));
    const error = await validate().catch((caught: Error) => caught);
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    expect(error.message).not.toContain("api-key");
  });
});

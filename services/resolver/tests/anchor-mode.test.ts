import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import { BN, BorshCoder, utils } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction } from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import { AnchorMarketAdapter, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_PROGRAM_ID, canonicalEventPayload, createMockWallet, deriveMarketPda } from "@hunch/sdk";
import type { SignedGameEvent, WalletSigner } from "@hunch/sdk";
import idl from "../../../packages/sdk/src/idl/marketkit.json";
import { buildServer } from "../src/server.js";
import { ResolverStore } from "../src/store.js";
import { reconcileEvent } from "../src/real-mode.js";

// Real AnchorMarketAdapter over a simulated Devnet RPC. Nothing reaches a network.
const coder = new BorshCoder(idl as Idl), program = new PublicKey(HUNCH_PROGRAM_ID), mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT);
const SYSVAR_OWNER = new PublicKey("Sysvar1111111111111111111111111111111111111");
const seed = new Uint8Array(32).fill(6), blockhash = Keypair.generate().publicKey.toBase58();
const appKeys = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
const info = (data: Buffer, owner = program): AccountInfo<Buffer> => ({ data, owner, executable: false, lamports: 1, rentEpoch: 0 });

let creator: PublicKey, resolverKeys: Keypair, signer: WalletSigner, connection: Connection, adapter: AnchorMarketAdapter;
let store: ResolverStore, app: ReturnType<typeof buildServer>, market: PublicKey, marketId: string, eventId: string;
let accounts: Map<string, AccountInfo<Buffer>>, time: number, sent: Transaction[], blockHeight: number;
let statusAtBroadcast: unknown, chainStatus: unknown;

function clockInfo(unix: number) {
  const data = Buffer.alloc(40); data.writeBigInt64LE(BigInt(unix), 32);
  return info(data, SYSVAR_OWNER);
}
async function setMarket(overrides: Record<string, unknown> = {}) {
  const data = Buffer.alloc(coder.accounts.size("Market"));
  (await coder.accounts.encode("Market", { authority: creator, resolver: resolverKeys.publicKey, token_mint: mint, market_id: Array.from(seed),
    deadline: new BN(1100), pool: [new BN(10), new BN(20)], winning_outcome: null, status: { Active: {} },
    bump: deriveMarketPda(creator, seed).bump, ...overrides })).copy(data);
  accounts.set(market.toBase58(), info(data));
}
const keypairSigner = (keys: Keypair): WalletSigner => ({ publicKey: keys.publicKey,
  signTransaction: vi.fn(async tx => { if (tx instanceof Transaction) tx.partialSign(keys); else tx.sign([keys]); return tx; }) });

function server(options: Partial<Parameters<typeof buildServer>[0]> = {}) {
  app = buildServer({ adapter, signer, store, clock: () => time, tokenMint: mint.toBase58(), ...options });
  return app;
}
const sign = (overrides: Partial<SignedGameEvent> = {}): SignedGameEvent => {
  const event = { appId: "racing-demo", eventId, marketId, outcome: 1 as const, timestamp: time, ...overrides };
  return { ...event, signature: Buffer.from(nacl.sign.detached(canonicalEventPayload(event), appKeys.secretKey)).toString("base64") };
};
const post = (payload: unknown) => app.inject({ method: "POST", url: "/v1/events", payload: payload as object });

beforeEach(async () => {
  creator = Keypair.generate().publicKey; resolverKeys = Keypair.generate(); // Ephemeral test keys only.
  market = deriveMarketPda(creator, seed).address; marketId = market.toBase58(); eventId = "race-7-finished";
  time = 1200; sent = []; blockHeight = 1500; statusAtBroadcast = undefined; chainStatus = null;
  accounts = new Map([[program.toBase58(), { ...info(Buffer.alloc(0), SystemProgram.programId), executable: true }], [SYSVAR_CLOCK_PUBKEY.toBase58(), clockInfo(1200)]]);
  await setMarket();
  connection = new Connection("http://127.0.0.1:8899");
  vi.spyOn(connection, "getGenesisHash").mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  vi.spyOn(connection, "getAccountInfo").mockImplementation(async key => accounts.get(key.toBase58()) ?? null);
  vi.spyOn(connection, "getMultipleAccountsInfo").mockImplementation(async keys => keys.map(key => accounts.get(key.toBase58()) ?? null));
  vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({ blockhash, lastValidBlockHeight: 2000 });
  vi.spyOn(connection, "getFeeForMessage").mockResolvedValue({ context: { slot: 1 }, value: 5000 });
  vi.spyOn(connection, "getBalance").mockResolvedValue(1000000);
  vi.spyOn(connection, "getBlockHeight").mockImplementation(async () => blockHeight);
  vi.spyOn(connection, "getSignatureStatuses").mockImplementation(async () => ({ context: { slot: 1 }, value: [chainStatus as never] }));
  vi.spyOn(connection, "sendRawTransaction").mockImplementation(async bytes => {
    const tx = Transaction.from(bytes); sent.push(tx);
    statusAtBroadcast = store.getEvent(eventId);
    const decoded = coder.instruction.decode(tx.instructions.at(-1)!.data) as { data: { winning_outcome: number } };
    await setMarket({ winning_outcome: decoded.data.winning_outcome, status: { Resolved: {} } });
    return utils.bytes.bs58.encode(tx.signature!);
  });
  vi.spyOn(connection, "confirmTransaction").mockResolvedValue({ context: { slot: 9 }, value: { err: null } });
  signer = keypairSigner(resolverKeys);
  adapter = new AnchorMarketAdapter({ connection, clock: () => time, resolverAuthority: resolverKeys.publicKey.toBase58() });
  store = new ResolverStore(":memory:");
  store.registerApp({ appId: "racing-demo", publicKey: Buffer.from(appKeys.publicKey).toString("base64"), enabled: true });
  store.registerMarket({ appId: "racing-demo", marketId, eventId, authority: creator.toBase58(), resolverAuthority: resolverKeys.publicKey.toBase58() });
  server();
});
afterEach(async () => { await app.close(); store.close(); });

const signatureOf = (tx: Transaction) => utils.bytes.bs58.encode(tx.signature!);

describe("real-mode signed-event settlement", () => {
  it("verifies the signed event, persists the signature before broadcast, resolves on-chain, and records verified settlement", async () => {
    const response = await post(sign());
    expect(response.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    const signature = signatureOf(sent[0]);
    expect(statusAtBroadcast).toMatchObject({ status: "submitted", lastValidBlockHeight: 2000, transaction: { signature, status: "submitted" } });
    expect(response.json()).toMatchObject({
      eventId, marketId, mode: "anchor", status: "confirmed", error: null, lastValidBlockHeight: 2000,
      transaction: { mode: "anchor", id: signature, signature, status: "confirmed" },
      settlement: { marketStatus: "resolved", winningOutcome: 1, verifiedAt: 1200, source: "transaction" },
    });
    const decoded = coder.instruction.decode(sent[0].instructions[0].data)!;
    expect(decoded).toEqual({ name: "resolve_market", data: { winning_outcome: 1 } });
    expect(sent[0].feePayer!.equals(resolverKeys.publicKey)).toBe(true);
    expect((await app.inject(`/v1/events/${eventId}`)).json().status).toBe("confirmed");
    expect((await app.inject("/health")).json()).toEqual({ ok: true, mode: "anchor", network: "devnet", resolver: resolverKeys.publicKey.toBase58(), pendingEvents: 0 });
  });

  it("returns the same record for duplicates without a second transaction", async () => {
    const event = sign();
    const first = await post(event);
    time = 9999;
    const second = await post(event);
    expect(second.json()).toEqual(first.json());
    expect(sent).toHaveLength(1);
    expect((await post(sign({ outcome: 0, timestamp: 1200 }))).json().error.code).toBe("EVENT_CONFLICT");
  });

  it("rejects forged signatures and unregistered applications before reading the chain", async () => {
    const forged = { ...sign(), signature: Buffer.from(nacl.sign.detached(canonicalEventPayload(sign()), nacl.sign.keyPair().secretKey)).toString("base64") };
    expect((await post(forged)).statusCode).toBe(401);
    expect((await post(sign({ appId: "unknown-app" }))).statusCode).toBe(403);
    expect(connection.getAccountInfo).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("refuses arbitrary client-selected market IDs and event IDs", async () => {
    const other = deriveMarketPda(creator, new Uint8Array(32).fill(1)).address.toBase58();
    expect((await post(sign({ marketId: other }))).json().error.code).toBe("UNAUTHORIZED_MARKET");
    expect((await post(sign({ eventId: "another-event" }))).json().error.code).toBe("UNAUTHORIZED_EVENT");
    expect(sent).toHaveLength(0);
  });

  it("rejects incorrect application ownership", async () => {
    store.registerApp({ appId: "esports-demo", publicKey: Buffer.from(appKeys.publicKey).toString("base64"), enabled: true });
    expect((await post(sign({ appId: "esports-demo" }))).json().error.code).toBe("UNAUTHORIZED_MARKET");
    // A different stored creator no longer matches the PDA seeds, so the account is refused.
    await setMarket({ authority: Keypair.generate().publicKey });
    expect((await post(sign())).json().error.code).toBe("INVALID_MARKET_ACCOUNT");
    expect(sent).toHaveLength(0);
  });

  it("rejects a registration whose recorded creator differs from the on-chain market", async () => {
    await app.close(); store.close();
    store = new ResolverStore(":memory:");
    store.registerApp({ appId: "racing-demo", publicKey: Buffer.from(appKeys.publicKey).toString("base64"), enabled: true });
    store.registerMarket({ appId: "racing-demo", marketId, eventId, authority: Keypair.generate().publicKey.toBase58(), resolverAuthority: resolverKeys.publicKey.toBase58() });
    server();
    expect((await post(sign())).json().error.code).toBe("MARKET_AUTHORITY_MISMATCH");
    expect(sent).toHaveLength(0);
  });

  it("rejects a resolver signer that does not match the market's resolver", async () => {
    await app.close();
    const other = keypairSigner(Keypair.generate());
    server({ signer: other });
    expect((await post(sign())).json().error.code).toBe("MARKET_AUTHORITY_MISMATCH");
    await setMarket({ resolver: other.publicKey });
    expect((await post(sign())).json().error.code).toBe("MARKET_AUTHORITY_MISMATCH"); // Registration still names the original resolver.
    expect(sent).toHaveLength(0);
    expect(other.signTransaction).not.toHaveBeenCalled();
  });

  it("rejects early resolution by the backend deadline check", async () => {
    time = 1099;
    expect((await post(sign())).json().error.code).toBe("MARKET_INELIGIBLE");
    time = 1200;
    // A result stamped before the deadline is ineligible even when it is otherwise fresh.
    expect((await post(sign({ timestamp: 1099 }))).json().error.code).toBe("MARKET_INELIGIBLE");
    expect(store.getEvent(eventId)).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("records a definitive failure when the cluster clock has not reached the deadline", async () => {
    accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), clockInfo(1099));
    const response = await post(sign());
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ status: "failed", transaction: null, error: { code: "MARKET_NOT_CLOSED" } });
    expect(sent).toHaveLength(0);
  });

  it("rejects invalid outcomes", async () => {
    expect((await post({ ...sign(), outcome: 2 })).statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("rejects an already resolved market", async () => {
    await setMarket({ winning_outcome: 0, status: { Resolved: {} } });
    expect((await post(sign())).json().error.code).toBe("MARKET_INELIGIBLE");
    expect(sent).toHaveLength(0);
  });

  it("rejects a missing market and an invalid registered market address", async () => {
    accounts.delete(marketId);
    expect((await post(sign())).statusCode).toBe(404);
    store.registerMarket({ appId: "racing-demo", marketId: "not-a-market-address", eventId: "bad-finished", authority: creator.toBase58(), resolverAuthority: resolverKeys.publicKey.toBase58() });
    expect((await post(sign({ marketId: "not-a-market-address", eventId: "bad-finished" }))).json().error.code).toBe("INVALID_MARKET_ID");
  });

  it("rejects markets escrowing a different mint", async () => {
    await setMarket({ token_mint: Keypair.generate().publicKey });
    expect((await post(sign())).json().error.code).toBe("MARKET_MINT_MISMATCH");
    expect(sent).toHaveLength(0);
  });

  it("does not reserve the event when RPC is unavailable", async () => {
    vi.mocked(connection.getAccountInfo).mockRejectedValueOnce(new Error("fetch failed https://rpc.example/?api-key=secret"));
    const response = await post(sign());
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("RPC_UNAVAILABLE");
    expect(response.body).not.toContain("api-key");
    expect(store.getEvent(eventId)).toBeNull();
    expect((await post(sign())).statusCode).toBe(200);
  });

  it("records an uncertain submission with its signature and never resubmits", async () => {
    vi.mocked(connection.sendRawTransaction).mockImplementationOnce(async bytes => { sent.push(Transaction.from(bytes)); throw new Error("socket hang up"); });
    const response = await post(sign());
    expect(response.statusCode).toBe(202);
    const signature = signatureOf(sent[0]);
    expect(response.json()).toMatchObject({ status: "submitted", lastValidBlockHeight: 2000, settlement: null,
      transaction: { mode: "anchor", signature, status: "submitted" }, error: { code: "TRANSACTION_UNCERTAIN" } });
    expect((await post(sign())).statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    expect((await app.inject("/health")).json().pendingEvents).toBe(1);
  });

  it("holds a confirmed transaction whose market read-back fails for reconciliation", async () => {
    vi.mocked(connection.sendRawTransaction).mockImplementationOnce(async bytes => { const tx = Transaction.from(bytes); sent.push(tx); return signatureOf(tx); });
    const response = await post(sign());
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "submitted", settlement: null, error: { code: "VERIFICATION_PENDING" },
      transaction: { signature: signatureOf(sent[0]), status: "submitted" } });
  });

  it("never marks settled from a receipt when the independent read-back disagrees", async () => {
    vi.spyOn(adapter, "getMarket").mockResolvedValueOnce(await adapter.getMarket(marketId)).mockResolvedValueOnce(null);
    const response = await post(sign());
    expect(response.json()).toMatchObject({ status: "submitted", settlement: null, error: { code: "VERIFICATION_PENDING" } });
  });

  it("records preflight rejection as a definitive failure with its signature", async () => {
    vi.mocked(connection.getBalance).mockResolvedValueOnce(0);
    expect((await post(sign())).json()).toMatchObject({ status: "failed", error: { code: "INSUFFICIENT_FUNDS" }, transaction: null });
    expect(sent).toHaveLength(0);
  });

  it("disables mock endpoints and applies configured CORS independently of mock mode", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/mock/sessions", payload: {} })).statusCode).toBe(404);
    expect(() => buildServer({ adapter, signer, store, mockHttp: { creator: createMockWallet(creator), access: "local" } })).toThrow(/real-chain adapter/);
    await app.close();
    server({ corsOrigins: ["https://racing.example"] });
    const preflight = await app.inject({ method: "OPTIONS", url: `/v1/events/${eventId}`, headers: { origin: "https://racing.example", "access-control-request-method": "GET" } });
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://racing.example");
    const denied = await app.inject({ method: "GET", url: `/v1/events/${eventId}`, headers: { origin: "https://evil.example" } });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    expect(() => buildServer({ adapter, signer, store, corsOrigins: ["*"] })).toThrow(/exact HTTP/);
    expect(() => buildServer({ adapter, signer, store, corsOrigins: ["https://racing.example/path"] })).toThrow(/exact HTTP/);
  });

  it("emits no CORS headers when no origins are configured", async () => {
    const response = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://racing.example" } });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("reconciliation before any retry", () => {
  async function uncertain() {
    vi.mocked(connection.sendRawTransaction).mockImplementationOnce(async bytes => { sent.push(Transaction.from(bytes)); throw new Error("timeout"); });
    await post(sign());
    return signatureOf(sent[0]);
  }
  const reconcile = (release = false) => reconcileEvent({ store, adapter, eventId, now: 1300, release });

  it("confirms from the recorded signature and the resolved market", async () => {
    const signature = await uncertain();
    await setMarket({ winning_outcome: 1, status: { Resolved: {} } });
    chainStatus = { slot: 1, confirmations: null, err: null, confirmationStatus: "finalized" };
    const result = await reconcile();
    expect(result).toMatchObject({ action: "confirmed", retryable: false, record: { status: "confirmed", error: null,
      transaction: { signature, status: "confirmed" }, settlement: { winningOutcome: 1, source: "transaction", verifiedAt: 1300 } } });
    expect(connection.getSignatureStatuses).toHaveBeenCalledWith([signature], { searchTransactionHistory: true });
  });

  it("confirms from market state when the signature status is unavailable", async () => {
    await uncertain();
    await setMarket({ winning_outcome: 1, status: { Resolved: {} } });
    expect((await reconcile()).record).toMatchObject({ status: "confirmed", settlement: { source: "market-state" } });
  });

  it("fails on a conflicting on-chain outcome and never releases it", async () => {
    await uncertain();
    await setMarket({ winning_outcome: 0, status: { Resolved: {} } });
    expect(await reconcile(true)).toMatchObject({ action: "failed", retryable: false, record: { status: "failed", error: { code: "OUTCOME_CONFLICT" } } });
  });

  it("keeps an unexpired unseen signature pending and refuses release", async () => {
    await uncertain();
    blockHeight = 2000;
    expect(await reconcile(true)).toMatchObject({ action: "pending", retryable: false, record: { status: "submitted" } });
  });

  it("keeps a signature reported confirmed but not yet visible in market state pending", async () => {
    await uncertain();
    chainStatus = { slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" };
    expect((await reconcile(true)).action).toBe("pending");
  });

  it("retains an expired unseen signature because missing RPC history does not prove failure", async () => {
    await uncertain();
    blockHeight = 2001;
    expect(await reconcile()).toMatchObject({ action: "pending", retryable: false, record: { status: "submitted" } });
    expect(await reconcile(true)).toMatchObject({ action: "pending", retryable: false, record: { status: "submitted" } });
    const replay = await post(sign());
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({ status: "submitted", settlement: null });
    expect(sent).toHaveLength(1);
  });

  it("releases a signature that failed on-chain", async () => {
    await uncertain();
    chainStatus = { slot: 1, confirmations: null, err: { InstructionError: [0, { Custom: 6002 }] }, confirmationStatus: "finalized" };
    expect(await reconcile(true)).toMatchObject({ action: "released" });
    chainStatus = null;
    time = 1250;
    const retry = await post(sign());
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ status: "confirmed", settlement: { winningOutcome: 1 } });
    expect(sent).toHaveLength(2);
  });

  it("releases a failure that happened before any signature", async () => {
    vi.mocked(connection.getBalance).mockResolvedValueOnce(0);
    await post(sign());
    expect(await reconcile(true)).toMatchObject({ action: "released", retryable: true });
    expect(store.getEvent(eventId)).toBeNull();
  });

  it("leaves confirmed events unchanged and rejects unknown or mock events", async () => {
    await post(sign());
    expect((await reconcile(true)).action).toBe("unchanged");
    await expect(reconcileEvent({ store, adapter, eventId: "missing", now: 1300 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("never signs or submits", async () => {
    await uncertain();
    vi.mocked(signer.signTransaction).mockClear();
    blockHeight = 2001;
    await reconcile(true);
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });
});

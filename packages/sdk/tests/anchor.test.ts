import { beforeEach, describe, expect, it, vi } from "vitest";
import { BN, BorshCoder } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import idl from "../src/idl/marketkit.json";
import { AnchorMarketAdapter, Hunch, HUNCH_PROGRAM_ID, createMockWallet } from "../src/index.js";

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const programId = new PublicKey(HUNCH_PROGRAM_ID);
// Encode the actual snake_case IDL, independently of the adapter's camelCase Program.
const coder = new BorshCoder(idl as Idl);
async function fixture(overrides: Record<string, unknown> = {}, program = programId) {
  const state = {
    authority: key(1), resolver: key(2), token_mint: key(3), market_id: Array(32).fill(4),
    deadline: new BN(1100), pool: [new BN("9007199254740993"), new BN(17)],
    winning_outcome: null, status: { Active: {} }, ...overrides,
  };
  const [pubkey, bump] = PublicKey.findProgramAddressSync([
    Buffer.from("market"), state.authority.toBuffer(), Buffer.from(state.market_id),
  ], program);
  const encoded = await coder.accounts.encode("Market", { ...state, bump });
  // Rust allocates INIT_SPACE including the largest Option variant, even for None.
  const data = Buffer.alloc(164);
  encoded.copy(data);
  const account: AccountInfo<Buffer> = { data, owner: program, executable: false, lamports: 1, rentEpoch: 0 };
  return { pubkey, account };
}

let connection: Connection, adapter: AnchorMarketAdapter, now: number;
beforeEach(() => {
  now = 1000;
  connection = new Connection("http://127.0.0.1:8899");
  vi.spyOn(connection, "getAccountInfo").mockResolvedValue(null);
  vi.spyOn(connection, "getProgramAccounts").mockResolvedValue([]);
  adapter = new AnchorMarketAdapter({ connection, clock: () => now });
});

describe("Anchor read-only markets", () => {
  it("decodes the committed account layout and uses the PDA as the ID", async () => {
    const { pubkey, account } = await fixture();
    vi.mocked(connection.getAccountInfo).mockResolvedValue(account);
    expect(await adapter.getMarket(pubkey.toBase58())).toEqual({
      id: pubkey.toBase58(), authority: key(1).toBase58(), resolverAuthority: key(2).toBase58(),
      tokenMint: key(3).toBase58(), closesAt: 1100, pools: [9007199254740993n, 17n],
      totalPool: 9007199254741010n, status: "open", winningOutcome: null, metadata: null,
      marketSeed: new Uint8Array(32).fill(4),
    });
    expect(connection.getAccountInfo).toHaveBeenCalledWith(pubkey, "confirmed");
  });

  it("preserves the full u64 range and bigint sums without Number conversion", async () => {
    const max = (1n << 64n) - 1n;
    const { pubkey, account } = await fixture({ pool: [new BN(max.toString()), new BN(max.toString())] });
    vi.mocked(connection.getAccountInfo).mockResolvedValue(account);
    expect(await adapter.getMarket(pubkey.toBase58())).toMatchObject({ pools: [max, max], totalPool: max * 2n });
  });

  it.each([[1099, "open"], [1100, "closed"], [1101, "closed"]])("derives deadline state at %s", async (time, status) => {
    const { pubkey, account } = await fixture();
    now = time as number;
    vi.mocked(connection.getAccountInfo).mockResolvedValue(account);
    expect((await adapter.getMarket(pubkey.toBase58()))?.status).toBe(status);
  });

  it.each([0, 1])("preserves resolved outcome %s even before the deadline", async (winning_outcome) => {
    const { pubkey, account } = await fixture({ status: { Resolved: {} }, winning_outcome });
    vi.mocked(connection.getAccountInfo).mockResolvedValue(account);
    expect(await adapter.getMarket(pubkey.toBase58())).toMatchObject({ status: "resolved", winningOutcome: winning_outcome });
  });

  it("preserves cancelled state", async () => {
    const { pubkey, account } = await fixture({ status: { Cancelled: {} } });
    vi.mocked(connection.getAccountInfo).mockResolvedValue(account);
    expect((await adapter.getMarket(pubkey.toBase58()))?.status).toBe("cancelled");
  });

  it("returns null only for an absent account and [] for an empty program query", async () => {
    expect(await adapter.getMarket(key(20).toBase58())).toBeNull();
    expect(await adapter.listMarkets()).toEqual([]);
  });

  it.each(["foreign owner", "executable account", "wrong discriminator", "truncated", "oversized", "invalid enum", "invalid option", "wrong bump"])("rejects %s", async (kind) => {
    const { pubkey, account } = await fixture();
    if (kind === "foreign owner") account.owner = key(20);
    if (kind === "executable account") account.executable = true;
    if (kind === "wrong discriminator") account.data[0] ^= 255;
    if (kind === "truncated") account.data = account.data.subarray(0, 100);
    if (kind === "oversized") account.data = Buffer.concat([account.data, Buffer.from([0])]);
    if (kind === "invalid enum") account.data[161] = 255;
    if (kind === "invalid option") account.data[160] = 255;
    if (kind === "wrong bump") account.data[162] ^= 1;
    vi.mocked(connection.getAccountInfo).mockResolvedValue(account);
    await expect(adapter.getMarket(pubkey.toBase58())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a Position account instead of treating it as a missing Market", async () => {
    const { pubkey, account } = await fixture();
    const data = await coder.accounts.encode("Position", {
      market: pubkey, wallet: key(1), outcome: 0, amount: new BN(1), claimed: false, bump: 1,
    });
    vi.mocked(connection.getAccountInfo).mockResolvedValue({ ...account, data });
    await expect(adapter.getMarket(pubkey.toBase58())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a valid account payload at an incorrect PDA", async () => {
    vi.mocked(connection.getAccountInfo).mockResolvedValue((await fixture()).account);
    await expect(adapter.getMarket(key(20).toBase58())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    { deadline: new BN("9007199254740992") },
    { deadline: new BN("-9007199254740992") },
    { status: { Resolved: {} }, winning_outcome: null },
    { status: { Resolved: {} }, winning_outcome: 2 },
    { status: { Active: {} }, winning_outcome: 0 },
  ])("rejects unsafe deadlines and inconsistent state: %j", async (overrides) => {
    const { pubkey, account } = await fixture(overrides);
    vi.mocked(connection.getAccountInfo).mockResolvedValue(account);
    await expect(adapter.getMarket(pubkey.toBase58())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("queries program-owned Market accounts and filters normalized state", async () => {
    const open = await fixture();
    const closed = await fixture({ market_id: Array(32).fill(5), deadline: new BN(1000) });
    const otherCreator = await fixture({ authority: key(9) });
    vi.mocked(connection.getProgramAccounts).mockResolvedValue([open, closed, otherCreator]);
    expect((await adapter.listMarkets({ authority: key(1).toBase58(), status: "closed" })).map(m => m.id)).toEqual([closed.pubkey.toBase58()]);
    expect(connection.getProgramAccounts).toHaveBeenCalledWith(programId, {
      commitment: "confirmed", filters: [
        { dataSize: 164 }, { memcmp: coder.accounts.memcmp("Market") },
        { memcmp: { offset: 8, bytes: key(1).toBase58() } },
      ],
    });
    const markets = await adapter.listMarkets();
    markets[0].pools[0] = 0n;
    expect((await adapter.listMarkets())[0].pools[0]).toBe(9007199254740993n);
  });

  it("also rejects invalid accounts returned by program queries", async () => {
    const bad = await fixture();
    bad.account.owner = key(20);
    vi.mocked(connection.getProgramAccounts).mockResolvedValue([bad]);
    await expect(adapter.listMarkets()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("propagates RPC failures distinctly from missing accounts", async () => {
    vi.mocked(connection.getAccountInfo).mockRejectedValue(new Error("RPC offline"));
    vi.mocked(connection.getProgramAccounts).mockRejectedValue(new Error("RPC offline"));
    await expect(adapter.getMarket(key(20).toBase58())).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await expect(adapter.listMarkets()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("validates addresses and configuration without attempting RPC calls", async () => {
    expect(() => new AnchorMarketAdapter({ programId: "not-a-key" })).toThrow(/valid program/);
    expect(() => new AnchorMarketAdapter({ rpcUrl: "invalid" })).toThrow(/RPC URL/);
    await expect(adapter.getMarket("race-42")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(adapter.listMarkets({ authority: "bad" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(connection.getAccountInfo).not.toHaveBeenCalled();
    expect(connection.getProgramAccounts).not.toHaveBeenCalled();
  });

  it("supports a configured program and Hunch reads without a wallet", async () => {
    const customProgram = key(21);
    const market = await fixture({}, customProgram);
    vi.mocked(connection.getAccountInfo).mockResolvedValue(market.account);
    const client = new Hunch({ mode: "anchor", programId: customProgram.toBase58(), connection, clock: () => 1000 });
    expect(client.wallet).toBeUndefined();
    expect((await client.getMarket(market.pubkey.toBase58()))?.id).toBe(market.pubkey.toBase58());
    expect(await client.listMarkets()).toEqual([]);
  });

  it("needs no signer, signature, or submission for reads", async () => {
    const send = vi.spyOn(connection, "sendRawTransaction");
    expect(await adapter.getMarket(key(20).toBase58())).toBeNull();
    expect(await adapter.listMarkets()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  MockMarketKitClient,
  DEMO_WALLET,
} from "../adapters/MockMarketKitClient";
import { SdkMarketKitClient } from "../adapters/SdkMarketKitClient";
import { parseStake } from "../types";

describe("adapter contract", () => {
  it("preserves integers above Number.MAX_SAFE_INTEGER", () => {
    expect(parseStake("9007199254740993")).toBe(9007199254740993n);
  });
  it("accumulates positions, changes balances, and rejects late stakes", async () => {
    const client = new MockMarketKitClient({ persist: false, latencyMs: 0 });
    await client.predict({
      marketId: "race-42",
      outcome: 0,
      amount: 10n,
      walletAddress: DEMO_WALLET,
    });
    await client.predict({
      marketId: "race-42",
      outcome: 0,
      amount: 5n,
      walletAddress: DEMO_WALLET,
    });
    expect((await client.getPositions("race-42", DEMO_WALLET))[0].amount).toBe(
      15n,
    );
    expect(await client.getTokenBalance(DEMO_WALLET)).toBe(985n);
    await client.closeDemoMarket("race-42");
    await expect(
      client.predict({
        marketId: "race-42",
        outcome: 1,
        amount: 1n,
        walletAddress: DEMO_WALLET,
      }),
    ).rejects.toThrow("closed");
  });
  it("completes a race, resolves its fixture, and pays a position only once", async () => {
    const client = new MockMarketKitClient({ persist: false, latencyMs: 0 });
    await expect(client.startRace("race-42")).rejects.toThrow("close");
    await client.predict({
      marketId: "race-42",
      outcome: 0,
      amount: 10n,
      walletAddress: DEMO_WALLET,
    });
    await client.closeDemoMarket("race-42");
    const race = await client.startRace("race-42");
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(race.startedAt! + race.durationMs + 1);
    expect((await client.getRace("race-42")).winner).toBe(0);
    expect((await client.getMarket("race-42")).status).toBe("resolved");
    expect(
      (await client.getClaimableAmount("race-42", DEMO_WALLET)).amount,
    ).toBe(16n);
    const results = await Promise.allSettled([
      client.claimWinnings({
        marketId: "race-42",
        outcome: 0,
        walletAddress: DEMO_WALLET,
      }),
      client.claimWinnings({
        marketId: "race-42",
        outcome: 0,
        walletAddress: DEMO_WALLET,
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await client.getTokenBalance(DEMO_WALLET)).toBe(1006n);
    expect(
      (await client.getClaimableAmount("race-42", DEMO_WALLET)).claimed,
    ).toBe(true);
    clock.mockRestore();
  });
  it("creates a fresh demo race without resetting existing stakes", async () => {
    const client = new MockMarketKitClient({ persist: false, latencyMs: 0 });
    await client.predict({
      marketId: "race-42",
      outcome: 0,
      amount: 5n,
      walletAddress: DEMO_WALLET,
    });
    const next = await client.newDemoRace();
    expect(next.id).not.toBe("race-42");
    expect((await client.getPositions("race-42", DEMO_WALLET))[0].amount).toBe(
      5n,
    );
  });
  it("fails explicitly when live SDK capabilities are missing", async () => {
    const client = new SdkMarketKitClient({
      connection: new Connection("https://api.devnet.solana.com"),
      getWallet: () => ({ publicKey: null }),
    });
    await expect(client.getClaimableAmount("id", "wallet")).rejects.toThrow(
      "getClaimableAmount SDK binding",
    );
    await expect(client.newDemoRace()).rejects.toThrow("cannot be reset");
    await expect(
      client.confirmTransaction({
        signature: "demo-id",
        simulated: true,
        status: "submitted",
      }),
    ).rejects.toThrow("Simulated transactions");
  });
  it("rejects a non-Devnet RPC before giving a binding access to the signer", async () => {
    const connection = new Connection("https://api.devnet.solana.com");
    vi.spyOn(connection, "getGenesisHash").mockResolvedValue(
      "different-network",
    );
    const predict = vi.fn();
    const client = new SdkMarketKitClient({
      connection,
      getWallet: () => ({ publicKey: PublicKey.default }),
      bindings: { predict },
    });
    await expect(
      client.predict({
        marketId: "id",
        outcome: 0,
        amount: 1n,
        walletAddress: PublicKey.default.toBase58(),
      }),
    ).rejects.toThrow("only signs");
    expect(predict).not.toHaveBeenCalled();
  });
  it("racing and esports import the one exported widget", async () => {
    for (const app of ["racing", "esports"]) {
      const source = await readFile(
        resolve(process.cwd(), "../../apps", app, "src/App.tsx"),
        "utf8",
      );
      expect(source).toContain("PredictionMarket");
      expect(source).toMatch(/from ["']@marketkit\/react["']/);
      expect(source).not.toContain("function PredictionMarket");
    }
  });
  it("starts a live race after the deadline even before status polling closes it", async () => {
    const client = new SdkMarketKitClient({
      connection: new Connection("https://api.devnet.solana.com"),
      getWallet: () => ({ publicKey: null }),
      bindings: {
        startRace: async (marketId) => ({
          marketId,
          status: "racing",
          durationMs: 12000,
          winner: null,
          simulated: false,
        }),
      },
    });
    const getMarket = vi.spyOn(client, "getMarket").mockResolvedValue({
      id: "race",
      question: "Who wins?",
      outcomes: ["A", "B"],
      pools: [0n, 0n],
      totalPool: 0n,
      closesAt: Math.floor(Date.now() / 1000) - 1,
      status: "open",
      winningOutcome: null,
    });
    expect((await client.startRace("race")).status).toBe("racing");
    getMarket.mockResolvedValue({
      ...(await client.getMarket("race")),
      closesAt: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(client.startRace("race")).rejects.toThrow("close");
  });
});

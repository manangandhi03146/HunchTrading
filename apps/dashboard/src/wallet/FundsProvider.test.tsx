// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { FundsReceipt, TransferQuote } from "./transactions";
const mocks = vi.hoisted(() => ({
  wallet: {} as Record<string, any>,
  connection: {
    rpcEndpoint: "test-devnet",
    getBalance: vi.fn(),
    getGenesisHash: vi.fn(),
    requestAirdrop: vi.fn(),
  },
  send: vi.fn(),
  prepare: vi.fn(),
  check: vi.fn(),
}));
vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: () => ({ connection: mocks.connection }),
  useWallet: () => mocks.wallet,
}));
vi.mock("./transactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transactions")>()),
  sendTransfer: mocks.send,
  prepareTransfer: mocks.prepare,
  receiptStatus: mocks.check,
}));
import { FundsProvider, useFunds } from "./FundsProvider";
import { HUNCH_DEVNET_GENESIS_HASH } from "@hunch/sdk";
const owner = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey.toBase58();
const quote: TransferQuote = {
  owner: owner.toBase58(),
  recipient,
  lamports: 10_000_000,
  fee: 5000,
  balance: 1_000_000_000,
  blockhash: recipient,
  lastValidBlockHeight: 1000,
  transaction: new Transaction(),
};
const receipt: FundsReceipt = {
  owner: owner.toBase58(),
  recipient,
  lamports: 10_000_000,
  kind: "send",
  signature: bs58.encode(new Uint8Array(64).fill(1)),
  status: "pending",
  createdAt: 100,
};
function hook() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(useFunds, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <FundsProvider>{children}</FundsProvider>
      </QueryClientProvider>
    ),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  Object.assign(mocks.wallet, { publicKey: owner, signTransaction: vi.fn() });
  mocks.connection.getGenesisHash.mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  mocks.connection.getBalance.mockResolvedValue(1_000_000_000);
  mocks.prepare.mockResolvedValue(quote);
});
afterEach(cleanup);
describe("funds session safeguards", () => {
  it("locks a timed-out send behind its saved public receipt", async () => {
    mocks.send.mockImplementation(async (_connection, _quote, _sign, save) => {
      save(receipt);
      throw new Error("RPC timeout");
    });
    const { result } = hook();
    await act(async () => {
      await result.current.send(quote);
    });
    expect(result.current.receipts).toEqual([receipt]);
    expect(
      JSON.parse(localStorage.getItem("hunch:devnet-funds:v1:test-devnet")!),
    ).toEqual([receipt]);
    await act(async () => {
      await result.current.send(quote);
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(result.current.message).toMatch("pending receipt");
    await expect(result.current.review(recipient, "0.01")).rejects.toThrow(
      "pending receipt",
    );
  });
  it("restores a pending receipt and blocks the faucet on page reload", async () => {
    localStorage.setItem(
      "hunch:devnet-funds:v1:test-devnet",
      JSON.stringify([receipt]),
    );
    const { result } = hook();
    await act(async () => {
      await result.current.airdrop();
    });
    expect(mocks.connection.requestAirdrop).not.toHaveBeenCalled();
    expect(result.current.message).toMatch("pending receipt");
  });
  it("reconciles a pending signature without resubmitting it", async () => {
    localStorage.setItem(
      "hunch:devnet-funds:v1:test-devnet",
      JSON.stringify([receipt]),
    );
    mocks.check.mockResolvedValue({ ...receipt, status: "confirmed" });
    const { result } = hook();
    await act(async () => {
      await result.current.check(receipt);
    });
    expect(result.current.receipts[0].status).toBe("confirmed");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.connection.requestAirdrop).not.toHaveBeenCalled();
  });
  it("rejects a quote owned by a different wallet", async () => {
    const { result } = hook();
    await act(async () => {
      await result.current.send({
        ...quote,
        owner: Keypair.generate().publicKey.toBase58(),
      });
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.current.message).toMatch("same Devnet wallet");
  });
  it("blocks duplicate clicks while signing is outstanding", async () => {
    let finish!: (r: FundsReceipt) => void;
    mocks.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = hook();
    await act(async () => {
      const first = result.current.send(quote);
      const second = result.current.send(quote);
      expect(mocks.send).toHaveBeenCalledOnce();
      finish({ ...receipt, status: "confirmed" });
      await Promise.all([first, second]);
    });
    expect(result.current.busy).toBe(false);
  });
});

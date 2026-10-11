// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Keypair, Transaction } from "@solana/web3.js";
import type { TransferQuote } from "./transactions";
const mocks = vi.hoisted(() => ({
  funds: {} as Record<string, any>,
  connection: {
    rpcEndpoint: "test-devnet",
    getParsedTokenAccountsByOwner: vi.fn(),
    getGenesisHash: vi.fn(),
  },
}));
vi.mock("./FundsProvider", () => ({ useFunds: () => mocks.funds }));
vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: () => ({ connection: mocks.connection }),
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({
  WalletMultiButton: () => <button>Select Wallet</button>,
}));
vi.mock("@hunch/react", () => ({
  useHunch: () => ({ mode: "mock" }),
  CopyButton: () => <button>Copy address</button>,
}));
import { WalletFundsPage, SidebarFunds } from "./WalletFunds";
import { HUNCH_DEVNET_GENESIS_HASH } from "@hunch/sdk";
const owner = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();
const quote: TransferQuote = {
  owner,
  recipient,
  lamports: 10_000_000,
  fee: 5000,
  balance: 1_000_000_000,
  blockhash: owner,
  lastValidBlockHeight: 1000,
  transaction: new Transaction(),
};
function view() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <SidebarFunds />
        <WalletFundsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.getGenesisHash.mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  mocks.connection.getParsedTokenAccountsByOwner.mockResolvedValue({
    value: [],
  });
  Object.assign(mocks.funds, {
    owner,
    balance: { data: 1_000_000_000, isError: false, refetch: vi.fn() },
    busy: false,
    message: "",
    receipts: [],
    refresh: vi.fn(),
    review: vi.fn().mockResolvedValue(quote),
    send: vi.fn().mockResolvedValue(undefined),
    airdrop: vi.fn(),
    check: vi.fn(),
  });
});
afterEach(cleanup);
describe("wallet funds controls", () => {
  it("puts Add and Remove in the top-left funds section", () => {
    view();
    expect(screen.getByRole("link", { name: "Add" })).toHaveAttribute(
      "href",
      "/wallet#receive",
    );
    expect(screen.getByRole("link", { name: "Remove" })).toHaveAttribute(
      "href",
      "/wallet#send",
    );
    expect(screen.getByText("1 SOL")).toBeInTheDocument();
  });
  it("requires a connected real wallet before showing transfer controls", () => {
    mocks.funds.owner = null;
    view();
    expect(
      screen.getByRole("heading", { name: "Connect a Devnet wallet" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review transfer" }),
    ).not.toBeInTheDocument();
  });
  it("reviews a destination and fee before allowing wallet approval", async () => {
    view();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Recipient wallet"), recipient);
    await user.type(screen.getByLabelText("Amount in SOL"), "0.01");
    await user.click(screen.getByRole("button", { name: "Review transfer" }));
    expect(mocks.funds.review).toHaveBeenCalledWith(recipient, "0.01");
    expect(mocks.funds.send).not.toHaveBeenCalled();
    expect(screen.getByText("0.010005 SOL")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve in wallet" }));
    expect(mocks.funds.send).toHaveBeenCalledOnce();
    expect(mocks.funds.send).toHaveBeenCalledWith(quote);
  });
  it("invalidates a review when its input changes", async () => {
    view();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Recipient wallet"), recipient);
    await user.type(screen.getByLabelText("Amount in SOL"), "0.01");
    await user.click(screen.getByRole("button", { name: "Review transfer" }));
    await user.type(screen.getByLabelText("Amount in SOL"), "5");
    expect(
      screen.queryByRole("button", { name: "Approve in wallet" }),
    ).not.toBeInTheDocument();
    expect(mocks.funds.send).not.toHaveBeenCalled();
  });
  it("blocks both funding operations while a receipt is pending", async () => {
    mocks.funds.receipts = [
      {
        signature: "test-signature",
        owner,
        recipient,
        kind: "send",
        lamports: 10_000_000,
        status: "pending",
      },
    ];
    view();
    expect(
      screen.getByRole("button", { name: "Review transfer" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Request 0.1 Devnet SOL" }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Check status" }));
    expect(mocks.funds.check).toHaveBeenCalledWith(mocks.funds.receipts[0]);
    expect(mocks.funds.send).not.toHaveBeenCalled();
  });
  it("shows quote validation without requesting a wallet signature", async () => {
    mocks.funds.review.mockRejectedValue(
      new Error("Insufficient Devnet SOL, including the network fee."),
    );
    view();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Recipient wallet"), recipient);
    await user.type(screen.getByLabelText("Amount in SOL"), "100");
    await user.click(screen.getByRole("button", { name: "Review transfer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Insufficient Devnet SOL",
    );
    expect(mocks.funds.send).not.toHaveBeenCalled();
  });
  it("separates actual Devnet SOL from the livestream exhibition ledger", () => {
    view();
    expect(
      screen.getByText(/Adding Devnet SOL does not add exhibition credits/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Fund the exhibition account" }),
    ).toHaveAttribute("href", "/funding");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PredictionMarket } from "../components/PredictionMarket";
import { HunchProvider } from "../providers/HunchProvider";
import { MockHunchClient } from "../adapters/MockHunchClient";

function setup({
  client = new MockHunchClient({ persist: false, latencyMs: 0 }),
  connected = true,
  marketId = "race-42",
} = {}) {
  render(
    <HunchProvider client={client} defaultDemoConnected={connected}>
      <PredictionMarket marketId={marketId} />
    </HunchProvider>,
  );
  return { client, user: userEvent.setup() };
}
async function choose(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: /Player A/ }));
}
async function review(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole("button", {
    name: /Review prediction/,
  });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}
describe("reusable prediction widget", () => {
  it("renders the market, pool, and honest simulation label", async () => {
    setup();
    expect(
      await screen.findByText("Who takes the checkered flag?"),
    ).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText(/SIMULATED DEMO/)).toBeInTheDocument();
  });
  it("supports selecting either outcome", async () => {
    const { user } = setup();
    const first = await screen.findByRole("radio", { name: /Player A/ });
    const second = screen.getByRole("radio", { name: /Player B/ });
    await user.click(first);
    expect(first).toBeChecked();
    await user.click(second);
    expect(second).toBeChecked();
    expect(first).not.toBeChecked();
  });
  it.each(["", "-1", "0", "1.5", "1001"])(
    "rejects invalid stake %j without submitting",
    async (amount) => {
      const { user, client } = setup();
      const predict = vi.spyOn(client, "predict");
      await choose(user);
      const input = screen.getByLabelText("Your stake");
      await user.clear(input);
      if (amount) await user.type(input, amount);
      await review(user);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(predict).not.toHaveBeenCalled();
    },
  );
  it("requires a connected account", async () => {
    const { user } = setup({ connected: false });
    expect(
      await screen.findByRole("button", { name: "Connect demo account" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Review prediction/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Connect demo account" }),
    );
    expect(
      await screen.findByRole("button", { name: /Review prediction/ }),
    ).toBeInTheDocument();
  });
  it("disables predictions after the close", async () => {
    const client = new MockHunchClient({ persist: false, latencyMs: 0 });
    await client.closeDemoMarket("race-42");
    setup({ client });
    expect(
      await screen.findByText("Waiting for the official result"),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Player A/ })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Review prediction/ }),
    ).not.toBeInTheDocument();
  });
  it("shows pending state and waits for confirmation before success", async () => {
    const { user, client } = setup();
    let release!: (result: {
      signature: string;
      simulated: boolean;
      status: "confirmed";
    }) => void;
    vi.spyOn(client, "confirmTransaction").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await choose(user);
    await review(user);
    await user.click(
      screen.getByRole("button", { name: "Confirm prediction" }),
    );
    expect(
      await screen.findByRole("button", { name: "Awaiting confirmation…" }),
    ).toBeDisabled();
    expect(
      screen.queryByText("Demo prediction recorded"),
    ).not.toBeInTheDocument();
    release({
      signature: "demo-receipt",
      simulated: true,
      status: "confirmed",
    });
    expect(
      await screen.findByText("Demo prediction recorded"),
    ).toBeInTheDocument();
  });
  it("shows rejected transaction errors at the action", async () => {
    const { user, client } = setup();
    vi.spyOn(client, "predict").mockRejectedValue(
      new Error("Wallet rejected the transaction."),
    );
    await choose(user);
    await review(user);
    await user.click(
      screen.getByRole("button", { name: "Confirm prediction" }),
    );
    expect(
      await screen.findByText("Wallet rejected the transaction."),
    ).toBeInTheDocument();
  });
  it("displays resolved outcomes and disables ineligible claims", async () => {
    setup({ marketId: "orbit-echo" });
    expect(await screen.findByText("Team Echo wins")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Claim winnings" }),
    ).toBeDisabled();
  });
  it("handles unknown markets with a recoverable error", async () => {
    setup({ marketId: "unknown" });
    expect(
      await screen.findByText(/was not found/, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});

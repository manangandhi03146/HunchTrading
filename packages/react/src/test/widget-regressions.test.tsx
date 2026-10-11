import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PredictionMarket } from "../components/PredictionMarket";
import { Button } from "../components/ui";
import { HunchProvider } from "../providers/HunchProvider";
import { MockHunchClient, DEMO_WALLET } from "../adapters/MockHunchClient";
import type { Market } from "../types";

function client() {
  return new MockHunchClient({ persist: false, latencyMs: 0 });
}
describe("widget integration regressions", () => {
  it.each(["cancel", "escape"])(
    "returns focus to the review button after %s without committing a prediction",
    async (dismissal) => {
      const mock = client();
      const predict = vi.spyOn(mock, "predict");
      const user = userEvent.setup();
      render(
        <>
          <a href="#main">Skip to content</a>
          <HunchProvider client={mock} defaultDemoConnected>
            <PredictionMarket marketId="race-42" />
          </HunchProvider>
        </>,
      );
      await user.click(await screen.findByRole("radio", { name: /Player A/ }));
      const review = screen.getByRole("button", { name: /Review prediction/ });
      await waitFor(() => expect(review).toBeEnabled());
      await user.click(review);
      const dialog = screen.getByRole("dialog");
      if (dismissal === "cancel") {
        await user.click(
          within(dialog).getByRole("button", { name: "Go back" }),
        );
      } else {
        await user.keyboard("{Escape}");
      }
      await waitFor(() => expect(review).toHaveFocus());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(predict).not.toHaveBeenCalled();
    },
  );
  it("keeps embedded widget actions from submitting the host form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <HunchProvider client={client()}>
          <PredictionMarket marketId="race-42" />
        </HunchProvider>
      </form>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Connect demo account" }),
    );
    await user.click(await screen.findByRole("radio", { name: /Player A/ }));
    const review = screen.getByRole("button", { name: /Review prediction/ });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("preserves explicitly requested form submission", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  it.each(["resolved", "cancelled"] as const)(
    "respects hidden wallet controls on a %s market",
    async (status) => {
      const mock = client();
      const market = await mock.getMarket("orbit-echo");
      vi.spyOn(mock, "getMarket").mockResolvedValue({ ...market, status });
      render(
        <HunchProvider client={mock}>
          <PredictionMarket marketId="orbit-echo" showWalletButton={false} />
        </HunchProvider>,
      );
      expect(
        await screen.findByText("Connect your account to check your position."),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Connect demo account" }),
      ).not.toBeInTheDocument();
    },
  );
  it("clears old market and account data when a same-mode client is replaced", async () => {
    const first = client();
    const second = client();
    const nextMarket = {
      ...(await second.getMarket("race-42")),
      question: "Replacement market",
    };
    let release!: (market: Market) => void;
    vi.spyOn(second, "getMarket").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vi.spyOn(second, "getTokenBalance").mockResolvedValue(12n);
    const view = render(
      <HunchProvider client={first} defaultDemoConnected>
        <PredictionMarket marketId="race-42" />
      </HunchProvider>,
    );
    expect(await screen.findByText("1,000 TEST available")).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("radio", { name: /Player A/ }));
    view.rerender(
      <HunchProvider client={second} defaultDemoConnected>
        <PredictionMarket marketId="race-42" />
      </HunchProvider>,
    );
    expect(
      screen.queryByText("Who takes the checkered flag?"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("1,000 TEST available")).not.toBeInTheDocument();
    await waitFor(() => expect(second.getMarket).toHaveBeenCalled());
    await act(async () => release(nextMarket));
    expect(await screen.findByText("Replacement market")).toBeInTheDocument();
    expect(await screen.findByText("12 TEST available")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Player A/ })).not.toBeChecked();
  });
  it("shows refreshed-balance validation inside the themed review modal", async () => {
    const mock = client();
    const predict = vi.spyOn(mock, "predict");
    const user = userEvent.setup();
    render(
      <HunchProvider client={mock} defaultDemoConnected>
        <PredictionMarket marketId="race-42" theme="light" />
      </HunchProvider>,
    );
    await user.click(await screen.findByRole("radio", { name: /Player A/ }));
    const review = screen.getByRole("button", { name: /Review prediction/ });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("hunch-theme-light");
    await act(async () => {
      await mock.predict({
        marketId: "nova-titan",
        outcome: 0,
        amount: 995n,
        walletAddress: DEMO_WALLET,
      });
    });
    await screen.findByText("5 TEST available");
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm prediction" }),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "exceeds your available TEST balance",
    );
    expect(predict).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClaimPanel } from "../components/ClaimPanel";
import { readClaimReceipt, saveClaimReceipt } from "../components/claimReceipt";
import { HunchProvider } from "../providers/HunchProvider";
import { MockHunchClient } from "../adapters/MockHunchClient";

describe("confirmed claim history", () => {
  it("retains the confirmed payout across remounts while showing zero remaining", async () => {
    const client = new MockHunchClient({ persist: false, latencyMs: 0 });
    const market = await client.getMarket("orbit-echo");
    let claimed = false;
    vi.spyOn(client, "getClaimableAmount").mockImplementation(async () => ({
      amount: claimed ? 0n : 25n,
      claimed,
    }));
    vi.spyOn(client, "claimWinnings").mockImplementation(async () => {
      claimed = true;
      return {
        signature: "demo-claim-history",
        simulated: true,
        status: "submitted",
      };
    });
    const ui = (
      <HunchProvider client={client} defaultDemoConnected>
        <ClaimPanel market={market} />
      </HunchProvider>
    );
    const view = render(ui);
    const button = await screen.findByRole("button", {
      name: "Claim winnings",
    });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.setup().click(button);
    expect(
      await screen.findByText("Simulated payout: 25 HUNCH"),
    ).toBeInTheDocument();
    view.unmount();
    render(ui);
    expect(
      await screen.findByText("Simulated payout: 25 HUNCH"),
    ).toBeInTheDocument();
    expect(screen.getByText("Remaining to claim")).toBeInTheDocument();
    expect(screen.getByText("0 HUNCH")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Already claimed/ }),
    ).toBeDisabled();
  });

  it("does not save a payout when confirmation fails", async () => {
    const client = new MockHunchClient({ persist: false, latencyMs: 0 });
    const market = await client.getMarket("orbit-echo");
    vi.spyOn(client, "getClaimableAmount").mockResolvedValue({
      amount: 25n,
      claimed: false,
    });
    vi.spyOn(client, "claimWinnings").mockResolvedValue({
      signature: "demo-unconfirmed",
      simulated: true,
      status: "submitted",
    });
    vi.spyOn(client, "confirmTransaction").mockRejectedValue(
      new Error("Confirmation unavailable. Check the receipt before retrying."),
    );
    render(
      <HunchProvider client={client} defaultDemoConnected>
        <ClaimPanel market={market} />
      </HunchProvider>,
    );
    const button = await screen.findByRole("button", {
      name: "Claim winnings",
    });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.setup().click(button);
    expect(
      await screen.findByText(/Confirmation unavailable/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Simulated payout/)).not.toBeInTheDocument();
    expect(
      Array.from({ length: localStorage.length }, (_, i) =>
        localStorage.key(i),
      ).filter((key) => key?.startsWith("hunch.claim.v1:")),
    ).toHaveLength(0);
  });

  it("ignores malformed history and submitted receipts", () => {
    localStorage.setItem("receipt", '{"amount":"invalid","transaction":{}}');
    expect(readClaimReceipt("receipt")).toBeNull();
    localStorage.removeItem("receipt");
    saveClaimReceipt("receipt", {
      amount: "25",
      transaction: {
        signature: "pending",
        status: "submitted",
        simulated: true,
      },
    });
    expect(localStorage.getItem("receipt")).toBeNull();
  });

  it("keeps the widget usable when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readClaimReceipt("receipt")).toBeNull();
    expect(() =>
      saveClaimReceipt("receipt", {
        amount: "25",
        transaction: {
          signature: "confirmed",
          status: "confirmed",
          simulated: true,
        },
      }),
    ).not.toThrow();
  });
});

// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const wallet = vi.hoisted(() => ({ owner: "team-wallet", balance: { data: 200_000_000, isError: false } }));
vi.mock("../wallet/FundsProvider", () => ({ useFunds: () => wallet }));
import { DemoProvider } from "./DemoProvider";
import { FundingDemo } from "./FundingDemo";
beforeEach(() => localStorage.clear());
afterEach(cleanup);
it("shows the real balance separately and converts only exhibition SOL into HUNCH", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><DemoProvider><FundingDemo /></DemoProvider></MemoryRouter>);
  expect(screen.getByText("0.2 SOL")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Connect demo account" }));
  await user.click(screen.getByRole("button", { name: "Request 0.25 demo SOL" }));
  await user.click(screen.getByRole("button", { name: "Review modeled swap" }));
  await user.click(screen.getByRole("button", { name: "Confirm modeled swap" }));
  const state = JSON.parse(localStorage.getItem("hunch:exhibition:v1")!);
  expect(state.tokens).toBe(99);
  expect(state.sol).toBe(239_995_000);
  expect(state.receipts[0].action).toBe("Modeled SOL → HUNCH swap");
  expect(wallet.balance.data).toBe(200_000_000);
  expect(screen.getByRole("status").textContent).toContain("99 demo HUNCH received");
});

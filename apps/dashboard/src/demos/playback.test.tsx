// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const player = vi.hoisted(() => ({ props: null as any }));
vi.mock("./TwitchVod", () => ({
  VOD: { start: 1800 },
  TwitchVod: (props: any) => { player.props = props; return <div>Broadcast player</div>; },
}));
import { DemoProvider } from "./DemoProvider";
import { FortniteDemo } from "./FortniteDemo";
beforeEach(() => localStorage.clear());
afterEach(cleanup);
function view() {
  return render(<MemoryRouter><DemoProvider><FortniteDemo /></DemoProvider></MemoryRouter>);
}
it("updates paired quotes from playback and stops crowd transactions while paused", () => {
  view();
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("vod");
  const quotes = screen.getByLabelText("Changing demo outcome quotes");
  const initial = quotes.textContent;
  act(() => player.props.onReady(true));
  act(() => player.props.onTime(1832, false));
  expect(quotes.textContent).not.toBe(initial);
  const active = JSON.parse(localStorage.getItem("hunch:exhibition:v1")!);
  expect(active.tick).toBe(8);
  expect(active.activity.length).toBeGreaterThan(0);
  act(() => player.props.onTime(1840, true));
  expect(JSON.parse(localStorage.getItem("hunch:exhibition:v1")!).tick).toBe(8);
  act(() => player.props.onTime(1840, false));
  expect(JSON.parse(localStorage.getItem("hunch:exhibition:v1")!).tick).toBe(10);
  // Replayed timestamps never duplicate crowd stakes.
  const resumed = localStorage.getItem("hunch:exhibition:v1");
  act(() => player.props.onTime(1832, false));
  expect(localStorage.getItem("hunch:exhibition:v1")).toBe(resumed);
});
it("uses broadcast branding and rejects non-finite player timestamps", () => {
  const { container } = view();
  act(() => player.props.onReady(true));
  const original = localStorage.getItem("hunch:exhibition:v1");
  act(() => player.props.onTime(NaN, false));
  expect(localStorage.getItem("hunch:exhibition:v1")).toBe(original);
  expect(container.textContent).not.toMatch(/\bVOD\b|\bTEST\b/);
  expect(container.textContent).toContain("Recorded gameplay");
});

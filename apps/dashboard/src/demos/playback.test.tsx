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
import { demoReducer, initialDemo, share } from "./model";
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
  const graph = screen.getByRole("img", { name: /Match odds graph/ });
  const initialPoints = graph.querySelector('[data-outcome="yes"]')!.getAttribute("points");
  act(() => player.props.onReady(true));
  act(() => player.props.onTime(1832, false));
  expect(quotes.textContent).not.toBe(initial);
  expect(graph.querySelector('[data-outcome="yes"]')!.getAttribute("points")).not.toBe(initialPoints);
  const active = JSON.parse(localStorage.getItem("hunch:exhibition:v1")!);
  expect(active.tick).toBe(8);
  expect(active.activity.length).toBeGreaterThan(0);
  expect(graph.getAttribute("aria-label")).toContain(`Yes ${share(active.pool).toFixed(1)} percent`);
  expect(graph.querySelectorAll("polyline")).toHaveLength(2);
  act(() => player.props.onTime(1840, true));
  expect(JSON.parse(localStorage.getItem("hunch:exhibition:v1")!).tick).toBe(8);
  act(() => player.props.onTime(1840, false));
  expect(JSON.parse(localStorage.getItem("hunch:exhibition:v1")!).tick).toBe(10);
  // Replayed timestamps never duplicate crowd stakes.
  const resumed = localStorage.getItem("hunch:exhibition:v1");
  act(() => player.props.onTime(1832, false));
  expect(localStorage.getItem("hunch:exhibition:v1")).toBe(resumed);
});
it("restarts odds, history and playback each time the page is opened, retaining funding", () => {
  let saved = initialDemo();
  saved = demoReducer(saved, { type: "connect" });
  saved = demoReducer(saved, { type: "faucet" });
  saved = demoReducer(saved, { type: "grant" });
  saved = demoReducer(saved, { type: "stake", side: 0, amount: 100 });
  saved = demoReducer(saved, { type: "tick", tick: 32, second: 128 });
  localStorage.setItem("hunch:exhibition:v1", JSON.stringify(saved));
  const first = view();
  let fresh = JSON.parse(localStorage.getItem("hunch:exhibition:v1")!);
  expect(fresh.pool).toEqual([6200, 3800]);
  expect(fresh.history).toEqual([{ tick: 0, share: 62 }]);
  expect(fresh.position).toEqual([0, 0]);
  expect(fresh.tokens).toBe(1000);
  expect(player.props.seekTo).toBe(1800);
  act(() => player.props.onReady(true));
  act(() => player.props.onTime(1864, false));
  expect(JSON.parse(localStorage.getItem("hunch:exhibition:v1")!).tick).toBe(16);
  first.unmount();
  view();
  fresh = JSON.parse(localStorage.getItem("hunch:exhibition:v1")!);
  expect(fresh.tick).toBe(0);
  expect(fresh.pool).toEqual([6200, 3800]);
  expect(player.props.playing).toBe(false);
  expect(player.props.seekTo).toBe(1800);
});
it("raises Yes odds after modeled eliminations and lowers them during storm pressure", () => {
  view();
  act(() => player.props.onReady(true));
  act(() => player.props.onTime(1864, false));
  const beforeStorm = JSON.parse(localStorage.getItem("hunch:exhibition:v1")!);
  expect(share(beforeStorm.pool)).toBeGreaterThan(62);
  act(() => player.props.onTime(1896, false));
  const duringStorm = JSON.parse(localStorage.getItem("hunch:exhibition:v1")!);
  expect(share(duringStorm.pool)).toBeLessThan(share(beforeStorm.pool));
  const graph = screen.getByRole("img", { name: /Match odds graph/ });
  expect(graph.getAttribute("aria-label")).toContain(`Yes ${share(duringStorm.pool).toFixed(1)} percent`);
  expect(duringStorm.history.at(-1).share).toBe(share(duringStorm.pool));
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

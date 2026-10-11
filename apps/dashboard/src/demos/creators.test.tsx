// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const player = vi.hoisted(() => ({ props: null as any }));
vi.mock("./TwitchVod", () => ({ TwitchVod: (props: any) => { player.props = props; return <div>Broadcast player</div>; } }));
import { CreatorDirectory } from "./CreatorPages";
import { CREATORS, creatorDescription, creatorFromDescription } from "./creators";
import { DemoProvider } from "./DemoProvider";
import { FortniteDemo } from "./FortniteDemo";
beforeEach(() => localStorage.clear());
afterEach(cleanup);
it("filters creator cards by game and links to distinct profiles", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><CreatorDirectory /></MemoryRouter>);
  expect(screen.getAllByRole("link")).toHaveLength(4);
  await user.selectOptions(screen.getByLabelText("Filter creators by game"), "Valorant");
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(screen.getByRole("link", { name: /TenZ/ }).getAttribute("href")).toBe("/creators/tenz");
  expect(screen.queryByRole("link", { name: /SypherPK/ })).toBeNull();
});
it.each(CREATORS)("uses $name’s source, match rules and game-specific reactions", (creator) => {
  render(<MemoryRouter><DemoProvider><FortniteDemo creator={creator} /></DemoProvider></MemoryRouter>);
  expect(player.props.source.id).toMatch(/^\d+$/);
  expect(player.props.source.channel).toBe(creator.source.channel);
  expect(screen.getByRole("heading", { name: creator.question })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Create match market" }).getAttribute("href")).toBe(`/markets/new?creator=${creator.slug}`);
  act(() => player.props.onReady(true));
  act(() => player.props.onTime(creator.source.start + 68, false));
  const state = JSON.parse(localStorage.getItem("hunch:exhibition:v1")!);
  expect(state.activity[0].cue).toBe(creator.cues[2].label);
  expect(state.tick).toBe(17);
  expect(screen.getByRole("img", { name: /Match odds graph/ }).querySelectorAll("polyline")).toHaveLength(2);
});
it("retains approved gameplay references through shared market descriptions", () => {
  for (const creator of CREATORS) {
    expect(creatorFromDescription(creatorDescription(creator))).toBe(creator);
    expect(creatorFromDescription(creatorDescription(creator).replace(creator.source.url, "https://example.com/fake"))).toBeUndefined();
  }
  expect(creatorFromDescription("Hunch creator demo: unknown\n")).toBeUndefined();
  expect(creatorFromDescription()).toBeUndefined();
});

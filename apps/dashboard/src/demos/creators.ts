import { CUES, type MatchCue } from "./model";
import type { BroadcastSource } from "./TwitchVod";
export type Creator = {
  slug: string; name: string; game: string; about: string; question: string;
  rule: string; source: BroadcastSource; cues: readonly MatchCue[];
  ranked: boolean;
};
function source(channel: string, id: string, title: string): BroadcastSource {
  return { channel, id, title, start: 1800, url: `https://www.twitch.tv/videos/${id}` };
}
const warzoneCues: MatchCue[] = [
  { second: 0, label: "Squad deployment", detail: "Modeled crowd backs a top-nine squad finish.", bias: 62 },
  { second: 30, label: "Squad wipe", detail: "A modeled squad wipe draws Yes stakes.", bias: 90 },
  { second: 65, label: "Gulag pressure", detail: "A modeled elimination sends the odds toward No.", bias: 10 },
  { second: 100, label: "Buyback secured", detail: "A modeled buyback puts the squad back in contention.", bias: 85 },
  { second: 140, label: "Circle advantage", detail: "A modeled safe rotation attracts Yes stakes.", bias: 90 },
  { second: 180, label: "Final rotation", detail: "A modeled exposed rotation draws No stakes.", bias: 25 },
  { second: 220, label: "Top-nine checkpoint", detail: "The demo models a ninth-place squad finish.", bias: 100 },
];
const valorantCues: MatchCue[] = [
  { second: 0, label: "Map prediction", detail: "Modeled viewers start at 62% for PRX.", bias: 62 },
  { second: 30, label: "Opening duel won", detail: "A modeled opening pick attracts Yes stakes.", bias: 88 },
  { second: 65, label: "Economy under pressure", detail: "A modeled lost round draws No stakes.", bias: 12 },
  { second: 100, label: "Spike planted", detail: "A modeled successful plant shifts the crowd toward Yes.", bias: 85 },
  { second: 140, label: "Clutch secured", detail: "A modeled clutch attracts another wave of Yes stakes.", bias: 92 },
  { second: 180, label: "Overtime pressure", detail: "A modeled close score brings uncertainty.", bias: 28 },
  { second: 220, label: "Map result", detail: "The exhibition scenario models a PRX map win.", bias: 100 },
];
export const CREATORS: readonly Creator[] = [
  { slug: "sypherpk", name: "SypherPK", game: "Fortnite", about: "Fortnite gameplay · solo finish demo", question: "Will SypherPK finish higher than 10th?", rule: "Yes = 1st–9th. No = 10th or lower. The scripted exhibition finishes 9th.", source: source("SypherPK", "2895387839", "THE BEST 30 YEAR OLD FORTNITE PLAYER IN THE WORLD"), cues: CUES, ranked: true },
  { slug: "teep", name: "TeeP", game: "CoD Warzone", about: "Warzone gameplay · squad finish demo", question: "Will TeeP’s squad finish higher than 10th?", rule: "Yes = squad places 1st–9th. No = 10th or lower. The exhibition models ninth place.", source: source("TeePee", "2896918540", "HEAVY METAL HEROES INTO WARDOGS OR DEADLOCK"), cues: warzoneCues, ranked: true },
  { slug: "tenz", name: "TenZ", game: "Valorant", about: "Valorant watch party · T1 vs PRX", question: "Will PRX win the featured map on TenZ’s broadcast?", rule: "Yes = PRX wins the selected map. No = T1 wins. TenZ hosts the watch party; the exhibition models a PRX win, not a verified match result.", source: source("TenZ", "2895880225", "T1 vs. PRX VCT CHAMPIONS SHANGHAI"), cues: valorantCues, ranked: false },
  { slug: "tarik", name: "tarik", game: "Valorant", about: "Valorant watch party · LEVIATÁN vs MIBR", question: "Will LEVIATÁN win the featured map on tarik’s broadcast?", rule: "Yes = LEVIATÁN wins the selected map. No = MIBR wins. Tarik hosts the watch party; the exhibition models a LEVIATÁN win, not a verified match result.", source: source("tarik", "2371278950", "Highlight: LEVIATÁN vs MIBR - VCT Americas Kickoff"), cues: valorantCues.map(c => ({ ...c, detail: c.detail.replace(/PRX/g, "LEVIATÁN") })), ranked: false },
];
export function getCreator(slug: string | null | undefined) { return CREATORS.find(c => c.slug === slug); }
export function creatorDescription(creator: Creator) {
  return `Hunch creator demo: ${creator.slug}\nGameplay source: ${creator.source.url}\nGame: ${creator.game}\nOutcome rule: ${creator.ranked ? "Yes = 1st–9th; No = 10th or lower." : creator.slug === "tenz" ? "Yes = PRX wins the selected map; No = T1 wins." : "Yes = LEVIATÁN wins the selected map; No = MIBR wins."}\nIdentify the exact match/map and reference window before publishing. The source is a recorded demo, not a current live match.\nRecorded source; creator identity is a Twitch partner reference, not endorsement or verification of this market. An authorized resolver must verify the selected match result.`;
}
export function creatorFromDescription(description = "") {
  const slug = /^Hunch creator demo: ([a-z0-9]+)\n/.exec(description)?.[1];
  const creator = getCreator(slug);
  return creator && description.includes(`Gameplay source: ${creator.source.url}\n`) ? creator : undefined;
}

# Creator match markets

The Markets page includes curated Twitch partner references for SypherPK (Fortnite), TeeP/TeePee (CoD Warzone), TenZ (Valorant watch party) and tarik (Valorant watch party). These badges identify Twitch channels, not Hunch market verification or creator endorsement. The game labels describe selected demo sources, not what a creator is currently broadcasting.

## Demo flow

1. Open `/markets`, optionally filter creators by game, then choose a creator card.
2. `/creators/:creatorId` opens that creator's broadcast demo with its own source, binary question, outcome rule and game-specific cue timeline. Each visit starts fresh, preserving funding and releasing unclaimed exhibition stakes as described in `exhibition-demos.md`.
3. Play in the Twitch player. Every four seconds of playback, modeled crowd stakes update the paired quotes and both graph lines. Pause stops playback updates. Presentation clock is an explicit fallback when Twitch is unavailable. Cues are scripted examples, not detected from footage; final outcomes are not verified results of these recordings.
4. Choose **Create match market**. The existing form preloads the creator question, Yes/No outcomes and source/rule description. Identify the exact match or map and reference window, edit the question/rules, and choose a future prediction deadline before creating.
5. Create through the existing Hunch client. Shared-demo creation uses the shared API, and the resulting `/markets/:marketId` link includes the referenced gameplay above its prediction panel. Market stakes on this page use its actual configured ledger; playback does not fabricate trades in the shared market or resolve it. Live Devnet mode still requires its existing wallet/resolver configuration.
6. Share the market URL. Other devices need the hosted frontend and the same reachable shared API or Devnet setup. Localhost URLs are not public hosting.

## Source register

Checked official Twitch channel pages on 2026-10-11, including visible **Verified Partner** badges and video links:

| Creator | Source | Channel evidence | Selected source category |
| --- | --- | --- | --- |
| SypherPK | https://www.twitch.tv/videos/2895387839 | https://www.twitch.tv/sypherpk/videos | Fortnite |
| TeeP (channel TeePee) | https://www.twitch.tv/videos/2896918540 | https://www.twitch.tv/teepee/videos | Call of Duty: Warzone; multi-game broadcast |
| TenZ | https://www.twitch.tv/videos/2895880225 | https://www.twitch.tv/tenz/videos | T1 vs PRX Valorant watch party |
| tarik | https://www.twitch.tv/videos/2371278950 | https://www.twitch.tv/tarik/videos?filter=all | LEVIATÁN vs MIBR VCT Americas highlight/watch party |

Sources start at 00:30:00 for a 3:40 demonstration window. They are gameplay references, not independently verified match windows. Twitch recordings can expire, ads and embedding availability vary, and multi-game sources require checking the selected segment before a public demo. Update IDs/timestamps in `apps/dashboard/src/demos/creators.ts` when needed; do not download/rehost source footage.

## Integration and tests

No shared SDK interface, backend schema, mint or contract layout changed. The existing description field carries creator/source references. Only recognized catalog references restore the gameplay embed; changing/removing the source reference disables it. This parsing is for presentation, not a proof of identity or settlement authorization. Creators themselves have not registered signed-result keys or approved these markets.

Tests cover game filtering, per-creator source/question/cues, playback-driven graph updates, source reference round-trips, unknown/tampered references, pause/replay behavior and restart-on-entry. Ordinary tests remain local and never submit Devnet transactions.

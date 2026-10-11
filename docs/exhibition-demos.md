# Hunch exhibition demos

The dashboard serves `/fortnite` (also accessible through `/livestream`) and `/funding` (`/solana` redirects to funding). **Livestream demo** appears under Example Applications with SypherPK's name. The top-left **Funds** section opens the separate real Devnet wallet page, `/wallet`; see [wallet funds](wallet-funds.md). No SDK interfaces or contracts change.

## Run and present

1. Run `npm run dev:shared` to start the existing local shared demo API, then `npm run dev` for the dashboard at `http://127.0.0.1:5175`.
2. Open `/funding`. Connect an exhibition account, request 0.25 demo SOL, and receive the one-time 1,000 demo TEST grant.
3. Open `/fortnite`. Review and confirm a Yes or No stake. Start the exhibition and use **Next modeled event** to accelerate the presentation.
4. Pool shares, activity, and the chart reflect seeded simulated participants reacting to scripted cues. At the top-nine checkpoint the scenario resolves Yes with a modeled ninth-place result.
5. Claim a winning position once. Return to `/funding` to inspect the balances, escrow model, and receipts. Try the separately modeled SOL/TEST AMM swap.
6. Reset the exhibition with its confirmation control to run again. The exhibition ledger uses local storage and is shared by these two pages in one browser, not a hosted cross-device market or the existing SDK wallet.

## Gameplay source and synchronization

The actual recording is SypherPK's Twitch VOD `2895387839`, titled **THE BEST 30 YEAR OLD FORTNITE PLAYER IN THE WORLD**: https://www.twitch.tv/videos/2895387839. Twitch displayed **Verified Partner** on the channel when inspected. This badge is Twitch's channel status, not Hunch identity verification or an endorsement.

The official Twitch player is embedded with the actual page hostname as `parent`. It starts at 30 minutes. Playback remains subject to Twitch ads, VOD availability/expiry, browser restrictions, and network access. The VOD is embedded, not downloaded or rehosted.

**The scripted cues and ninth-place fixture do not describe a verified match in the recording.** They model how viewer stakes might react to eliminations, storm pressure, and recovery. No computer vision, Fortnite telemetry, or automated result oracle is implied. Presenter annotations can report an observed event and model the corresponding crowd reaction. A manually entered placement models settlement and cannot submit a real result.

The default presentation clock works independently of the player to support a short demonstration despite ads. **Sync to VOD playback** follows the official player's `getCurrentTime()` relative to the 30-minute starting point. Crowd ticks are monotonic to avoid generating duplicate stakes after a backward seek. Advancing the timeline applies skipped modeled ticks once. Pausing the exhibition stops automated crowd changes. Use the original Twitch link or retry if playback is blocked.

## Accounting and limitations

- Higher than tenth means places 1–9. Tenth or below is No.
- The initial modeled crowd pools are 6,200 Yes / 3,800 No TEST. These are fictional stakes, not adoption or volume evidence.
- Positions accumulate. Stakes debit the available balance and increment the matching pool. Final return is `floor(position * total_pool / winning_pool)` and includes the original winning stake.
- Modeled user mutations debit 5,000 lamports as an illustrative single-signature base fee. Account rent, priority fees, and resolver fee funding are omitted. Do not use the walkthrough as an all-in live fee quote.
- The separate constant-product exchange begins with 100 demo SOL / 1,000,000 demo TEST. It has no swap fee, rounds output down, moves both model reserves, and charges the modeled network fee. This is not a deployed DEX or a redeemable TEST/SOL pair.
- `DEMO-*` receipts are local exhibition identifiers, never transaction signatures or Explorer evidence.
- The balance/escrow view accounts for the user's claim only. It does not run the modeled crowd's claims.
- Live Devnet program/mint links are separate public resources. The full funded live lifecycle still depends on team signer access and authorized TEST funding.

Run `npm run test --workspace @hunch/dashboard` for ledger conservation, boundary, replay, payout, and validation checks. Run `npm run build --workspace @hunch/dashboard` for types and production build.

Twitch player integration reference: https://dev.twitch.tv/docs/embed/video-and-clips/

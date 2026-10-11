# hunch UI refinement verification

Reviewed and refined the dashboard overview, market list, market creation form,
integration playground, event stream, racing demo, esports demo, and shared
prediction widget on `feat/widget-demos`.

## Resolved findings

| Finding | Result |
| --- | --- |
| Mobile interactions buried below secondary content | Integration order is configuration → preview → expandable code/setup → details. Esports order is selected match → prediction → schedule. Racing puts prediction before the circuit and expandable operator controls. DOM order follows the mobile task order. |
| Large mobile dashboard header | Demo links share the logo row; navigation and account/theme controls use a compact layout. At 390px, content begins around 212px instead of approximately 325px. |
| Conflicting racing states | Header and circuit use the market deadline/status as well as race phase. Closed/finished mock markets offer a prominent fresh demo action. Existing markets and stakes are preserved. Only newly created mock races use the longer two-minute deadline. |
| Generic custom validation | Required/whitespace-only values, duplicate outcomes, and past/invalid closing times have associated field messages, invalid states, and focus on the first failing field. Input is preserved. The local timezone is named. |
| Explanations presented like live state | The settlement sequence is an explicitly labeled expandable explanation. Integration and dashboard network labels distinguish local simulation from SDK mode and configured public program IDs from verified deployments. |
| Disconnected/loading balance ambiguity | Disconnected users see “Connect to see balance”; pending queries show “Loading balance…”. Account controls name the disconnect action. |
| Opaque event IDs and mobile wrapping | Event rows link market questions to the correct integration preview, shorten IDs, offer full-ID copying with a manual-copy fallback, and align icon/content/metadata on a grid. |
| Claimed position showing unexplained zero | Completed claims show the remaining amount. Newly confirmed payouts retain public amount/receipt metadata across remounts on the same device, scoped by mode, program, market and account. Saved metadata never determines eligibility. Failed/unconfirmed receipts are not saved as payouts. |
| Small controls and supporting text | Primary buttons, theme switches, table open actions, close/retry controls and copy-ID controls have at least 44px hit heights; table shortcuts are 44×44. Supporting text has a 14px floor; mobile form, stake and search inputs use 16px. |
| CSS/documentation drift | Removed 500 overridden declarations while preserving selector order/media contexts; normalized the type steps, replaced old hardcoded feedback colors with semantic variables, and updated DESIGN.md. No detector ignore rules were added. |
| Additional narrow-screen defects | Status badges and pool values occupy separate rows at ≤480px. The racing orange marker text now passes the measured contrast threshold. |

At 390px, the integration preview starts around 769px (previously 1,917px),
esports prediction around 791px (previously 1,840px), and racing prediction
around 522px. These are measurements for the current fixture copy, not fixed
layout guarantees for every future market question.

## Verification

- `npm run build`: all workspaces build successfully. Dashboard was rebuilt after
  its final documentation/snippet changes.
- `npm run test --workspace @hunch/react`: 62 tests pass in seven suites. Four
  added tests cover confirmed payout history after remount, failed confirmation,
  malformed/submitted receipt records, and blocked browser storage.
- `git diff --check`: clean.
- Impeccable detector: zero findings for both `apps` and `packages/react/src`,
  compared with 143 advisories before refinement. A detector result is a technical
  signal, not an automatically generated heuristic score.
- All seven screens checked at 320×740 light and 390×844 dark; no document-level
  horizontal overflow. The 10px scrollbar explains client widths of 310/380px.
  All six market rows were measured to confirm badge/pool separation.
- Read-only computed-style checks covered rendered text against composed solid
  background colors in both theme matrices. No measured failures remain in the
  final inspected states. Disabled/faded controls were excluded. This check does
  not substitute for a full WCAG audit or test text over images/gradients.
- Desktop inspection covered overview, integration, racing and esports in dark
  mode, along with the existing desktop review of all routes. The responsive
  single-column layouts retain all operational data.
- Empty submission focuses the question and identifies required fields. A
  case-insensitive duplicate-outcome submission focuses Outcome B, associates
  its specific message, and preserves both outcome values.
- An empty event filter exposes “Show all events”; reset works. An event market
  link opens the correct market-specific preview.
- Keyboard-only widget review: Space selects the native outcome radio, Enter
  opens review, Escape dismisses it and restores focus to the review trigger
  with a visible 2px outline. No prediction was confirmed in the browser.

Screenshots, detector outputs and a viewport/contrast matrix are retained under
the ignored `.impeccable/review/ui-check-2026-10-10/` directory. The original
critique remains under `.impeccable/critique/` as the baseline.

## Scope and handoff

These changes preserve hunch's current design and shared SDK interfaces. No
credentials, contract instructions, deployments, real token transfers, or Devnet
transaction submissions were changed or exercised. Full screen-reader testing,
physical-device testing and a genuine 200% browser zoom pass remain outside
this verification. The prior 27/40 heuristic score is not a machine-test result;
closing its reported defects does not certify a universal 40/40 experience.

Run the existing console and demos with `npm run dashboard`, `npm run dev`, and
`npm run esports`. Use the theme switch, narrow the viewport, open the setup/race
disclosures, and submit duplicate outcomes to inspect the changes. Claim history
is only available for claims confirmed after this change on the current device;
previous claims do not acquire invented historical amounts.

Changes are local on `feat/widget-demos`; no push or deployment was performed.

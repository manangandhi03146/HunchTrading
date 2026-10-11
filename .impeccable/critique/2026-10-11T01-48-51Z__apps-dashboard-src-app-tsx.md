---
target: all hunch UI
total_score: 27
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\Manas\\Downloads\\hackru\\apps\\dashboard\\src\\App.tsx"
target_fingerprint: "sha256:cc9887108e9b483057c77693ac4e9bbb7efa533389155a6460be6eae5c036859"
target_path: "C:\\Users\\Manas\\Downloads\\hackru\\apps\\dashboard\\src\\App.tsx"
timestamp: 2026-10-11T01-48-51Z
slug: apps-dashboard-src-app-tsx
---
⚠️ DEGRADED: single-context (sub-agents declined by user)

Reviewed all seven hunch screens: overview, markets, creation, integration, events, racing, and esports. Desktop dark and mobile light were checked throughout, with additional light desktop and dark mobile/modal checks. This is a UI review; no application code was changed or transactions submitted.

**Design verdict:** Keep the existing visual identity. Moss, ivory, orange actions, restrained borders, and consistent typography suit the developer console and carry into the widget. The main weaknesses are mobile hierarchy and state clarity, rather than the aesthetic direction.

**Heuristic assessment** (0–4 each; all ten apply):

| Heuristic | Score | Main observation |
|---|---:|---|
| Visibility of system status | 2 | Race and explanatory pipeline labels can imply an inaccurate live state. |
| Match with the real world | 3 | Prediction terminology is understandable; opaque event IDs reduce clarity. |
| User control and freedom | 3 | Modal cancellation and empty-filter reset work. |
| Consistency and standards | 3 | Themes and widget controls are coherent. |
| Error prevention | 3 | Native required fields and prediction review help prevent mistakes. |
| Recognition rather than recall | 3 | Labels and grouping are clear. |
| Flexibility and efficiency | 2 | Important mobile interactions require too much scrolling. |
| Aesthetic and minimalist design | 3 | Calm presentation; some demo and documentation content precedes the task. |
| Error recovery | 2 | Custom form validation lacks field-specific recovery. |
| Help and documentation | 3 | Setup guidance is useful, but competes with the integration preview. |

**Total: 27/40.** This is a design assessment, not an accessibility certification.

**Strengths**

- Shared identity is recognizable across the console and embedded widget, while racing and esports retain their own character.
- Local simulation is disclosed, and pool-share copy avoids presenting predictions as guaranteed odds or payouts.
- The mobile prediction review is readable. Escape closes it and returns focus to the trigger; empty event filters provide a useful reset.

**Priority improvements**

1. **P1 — Bring the main interaction forward on phones.** At 390×844, the integration preview begins around 1,917px down and esports predictions around 1,840px down. The dashboard header/navigation stack uses about 325px. Put the preview immediately after its configuration, move the selected-match widget before the schedule/promo, and collapse secondary code/docs/operator controls. Impact: faster first prediction and easier judge walkthrough. Suggested commands: `impeccable adapt`, `impeccable layout`.
2. **P1 — Make racing status reflect the prediction window.** The observed default race says “PADDOCK OPEN” and “Upcoming” while its widget says predictions are closed. The primary action starts the race; starting a fresh demo is secondary. A new mock race allows only 30 seconds to predict. Show the actual prediction state, promote a fresh demo when appropriate, and consider 90–120 seconds for mock-only prediction windows. Preserve existing stakes and real Devnet deadlines. Suggested commands: `impeccable clarify`, `impeccable onboard`.
3. **P2 — Identify custom form errors at their fields.** Duplicate outcomes produce one generic question/outcome/deadline message. Focus remains on Create and no field is marked invalid. Add specific messages, associated descriptions, invalid state, and focus the first failing field while retaining entered values. Native empty-required validation already works. Suggested commands: `impeccable harden`, `impeccable clarify`.
4. **P2 — Separate explanatory copy from observed state.** The events pipeline always ends in “Transaction confirmed”; label it as an explanation or tie it to a selected event. Mock integration lists Devnet/“Awaiting deployment” without verifying deployment; use “Local demo” and “Program not configured” where appropriate. Disconnected “Balance unavailable” should say “Connect to see balance.” Impact: users can distinguish missing configuration, disconnection, and failure. Suggested command: `impeccable clarify`.
5. **P2 — Make event and completion details easier to inspect.** Event rows emphasize full UUIDs without a market link and wrap awkwardly on mobile. Use a market question plus a linked short ID/copy affordance, with aligned metadata. A claimed position displays “Already claimed” with 0 TEST; clarify that zero is the remaining claimable amount and retain confirmed payout/receipt details when available. Do not infer historical payouts from unavailable data. Suggested commands: `impeccable layout`, `impeccable harden`.

**Cognitive load and emotional journey:** Grouping is generally clear; dropdown option counts alone are not overload. Mobile scrolling delays the rewarding prediction interaction. Confirmation feels reassuring, but the closed first race and disconnected-balance wording can undermine confidence. First-time users need accurate next steps; mobile users need earlier predictions; keyboard users need field-specific error focus. A developer or judge comparing integrations benefits from seeing the live preview before lengthy setup instructions.

**Minor observations and technical signal:** The desktop table shortcut is 32×32 and the theme switch is 42px high; enlarge touch hit areas where practical, without treating these measurements alone as WCAG failures. Review small 11–12px metadata for readability. The detector reported 143 advisories: 106 font sizes, 6 radii, and 31 colors. Some flag old CSS overridden later: the rendered widget has a 16px radius and semantic moss/lime colors rather than the flagged earlier values. Other typography advisories reflect inconsistently documented size steps. Consolidate overrides and document tokens instead of blindly changing the palette. No browser console errors or horizontal overflow were observed in the checked views; 320px measurement covered the dashboard and esports, not racing.

**Limits:** No real wallet signing, network-loss exercise, full screen-reader session, 200% zoom pass, or complete Devnet lifecycle was performed. This report does not establish production transaction functionality or WCAG compliance.

Questions skipped: review only, as requested.

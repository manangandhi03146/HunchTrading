---
name: hunch
description: "A readable prediction workspace and embeddable market system."
colors:
  "paper": "#f5f4ee"
  "white": "#fffefa"
  "ink": "#203b32"
  "muted": "#5b6b62"
  "line": "#d6dcd0"
  "control-border": "#77877b"
  "moss": "#18392f"
  "moss-raised": "#25483b"
  "orange": "#b74723"
  "orange-hover": "#993a1c"
  "lime": "#d1efa0"
  "elevated": "#eeefe7"
  "success": "#287450"
  "warning": "#855820"
  "danger": "#9d3c2e"
  "dark-bg": "#102a22"
  "dark-text": "#f6f6ec"
  "dark-muted": "#bfd0c4"
  "dark-border": "#476356"
  "dark-control-border": "#779583"
  "dark-primary": "#f3a575"
  "dark-warning": "#f8cf99"
  "dark-danger": "#ffc2b6"
  "navigation-text": "#c4d3c9"
  "pool-green": "#386c50"
  "heading-green": "#648455"
  "green-tint": "#e2e9d8"
  "orange-tint": "#f5e7da"
  "soft": "#eef0e6"
  "row-hover": "#f5f6ef"
  "match-hover": "#e9eedf"
  "pool-track": "#e1e6d9"
  "pool-secondary": "#7b985e"
  "pool-muted": "#b2c2a5"
  "success-tint": "#e8efdc"
  "danger-tint": "#fbece6"
  "danger-border": "#e4bcae"
  "scrollbar": "#8b9e86"
  "dark-orange-hover": "#ffc09a"
  "dark-soft": "#1e3e31"
  "dark-green-tint": "#254c3b"
  "dark-orange-tint": "#553a2a"
  "dark-pool-green": "#9ac589"
  "dark-heading-green": "#adcc97"
  "dark-row-hover": "#203f33"
  "dark-match-hover": "#234436"
  "dark-pool-track": "#25483b"
  "dark-pool-secondary": "#a4ce87"
  "dark-pool-muted": "#628f71"
  "dark-success-tint": "#254c3b"
  "dark-danger-tint": "#452f2b"
  "dark-danger-border": "#925c4e"
  "dark-scrollbar": "#779785"
typography:
  "display":
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(36px, 3.5vw, 50px)"
    fontWeight: 750
    lineHeight: 1.13
    letterSpacing: "-0.035em"
  "headline":
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(28px, 2.7vw, 38px)"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  "title":
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  "section":
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: "-0.025em"
  "page-body":
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  "body":
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  "label":
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.4
  "caption":
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  "outcome-value":
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.03em"
rounded:
  "track": "3px"
  "badge": "5px"
  "notice": "6px"
  "navigation": "7px"
  "control": "8px"
  "waiting": "10px"
  "outcome": "12px"
  "card": "14px"
  "widget": "16px"
spacing:
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  "18": "18px"
  "20": "20px"
  "22": "22px"
  "24": "24px"
  "28": "28px"
  "32": "32px"
  "40": "40px"
  "48": "48px"
components:
  "button-primary":
    backgroundColor: "{colors.orange}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  "button-primary-dark":
    backgroundColor: "{colors.dark-primary}"
    textColor: "{colors.dark-bg}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  "button-primary-hover":
    backgroundColor: "color-mix(in srgb, var(--mk-primary) 85%, var(--mk-text))"
  "button-race-hover":
    backgroundColor: "{colors.orange-hover}"
  "button-secondary":
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  "button-ghost":
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  "stake-input":
    borderColor: "{colors.control-border}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 13px"
    height: "46px"
  "navigation-item":
    textColor: "{colors.navigation-text}"
    rounded: "{rounded.navigation}"
    padding: "12px"
  "theme-switch":
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.ink}"
    borderColor: "{colors.control-border}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    height: "42px"
  "navigation-item-active":
    backgroundColor: "{colors.lime}"
    textColor: "{colors.moss}"
    rounded: "{rounded.navigation}"
    padding: "12px"
  "status-success":
    textColor: "{colors.success}"
    rounded: "{rounded.badge}"
    padding: "4px 9px"
    size: "12px"
  "card":
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  "widget":
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.widget}"
    padding: "24px"
  "outcome-selector":
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.ink}"
    rounded: "{rounded.outcome}"
    padding: "16px 14px"
  "outcome-selected":
    backgroundColor: "color-mix(in srgb, var(--mk-primary) 9%, var(--mk-surface))"
    textColor: "{colors.orange}"
    rounded: "{rounded.outcome}"
    padding: "16px 14px"
---
# Design System: hunch

## Overview

**Creative North Star: "The Working Program"**

The Working Program translates the clarity of an Oslo festival program into a conventional developer workspace: deep moss navigation, ivory work areas, orange actions, aligned rows, and simple rules. Manrope gives the console and embedded prediction widget the same readable voice. The public wordmark is lowercase hunch.

The system is calm and operational. Information is grouped by lifecycle and task, with visible distinctions between simulated credits and Devnet test tokens. Light and dark working surfaces share the same moss and orange identity; navigation and code panels keep their moss frame. Selection is expressed through a border, a checkmark, and related pool emphasis. The chosen world uses no decorative timetable costume or shipping raster imagery.

**Key Characteristics:**

- Moss navigation with ivory or dark moss working surfaces.
- Orange actions with lime navigation selection.
- Readable Manrope text and tabular numeric values.
- Aligned rows, fine rules, and restrained rounded containers.
- Explicit transaction states, keyboard focus, and reduced motion.

## Colors

The palette combines warm paper with grounded greens; restrained orange marks actions and prediction selection. The frontmatter records the exact CSS values.

### Primary

- **Burnt orange** (`orange`): primary actions and selected light-theme outcomes. The shared button mixes this color with theme text on hover; the race action uses `orange-hover`.
- **Soft orange** (`dark-primary`): the same action role on dark pages and widgets, with dark background text for the primary button.

### Secondary

- **Lime** (`lime`): active navigation, sidebar identity details, dark-theme success, and text selection.
- **Pool green** and **heading green**: comparative pool and racer/team markers, and the repeated second line of demo headings.
- **Green tint** and **orange tint**: small racer, team, and application identity surfaces. These distinguish entities without creating competing primary actions.
- **Success, warning, and danger**: lifecycle and feedback text. Their dark-theme counterparts are lime, `dark-warning`, and `dark-danger`.

### Neutral

- **Paper**: page background and light stake-field surface.
- **White**: light widgets, forms, and table containers.
- **Elevated ivory**: secondary buttons, neutral feedback, and outcome tiles.
- **Ink, muted, and line**: main text, supporting text, and one-pixel dividers in the light theme.
- **Moss and raised moss**: navigation, code, integration surfaces, and the dark widget surface and elevation.
- **Dark background, text, muted, and border**: dark pages and widgets share these base, readable content, secondary content, and divider values.
- **Control border**: field and outcome boundaries use a stronger neutral than ordinary dividers, with at least 3:1 contrast against the resting control surface in each theme.
- **Navigation text**: resting dashboard links within the moss rail.

Theme assignment is semantic; colors are not an automatically inverted palette:

| Widget variable | Light theme token | Dark theme token |
| --- | --- | --- |
| `--mk-bg` | paper | dark-bg |
| `--mk-surface` | white | moss |
| `--mk-elevated` | elevated | moss-raised |
| `--mk-text` | ink | dark-text |
| `--mk-muted` | muted | dark-muted |
| `--mk-border` | line | dark-border |
| `--mk-control-border` | control-border | dark-control-border |
| `--mk-primary` | orange | dark-primary |
| `--mk-primary-text` | white (#ffffff) | dark-bg |
| `--mk-success` | success | lime |
| `--mk-warning` | warning | dark-warning |
| `--mk-danger` | danger | dark-danger |

The dashboard rail locally assigns lime to `--mk-primary`; dark application headers use soft orange. Preserve these contextual assignments. Status backgrounds mix their semantic color at 7% with the surface, with a 30% border mix. Error surfaces use 5% and 25%; selected outcomes use 9%.

### Page theme and widget theme

`packages/react/src/tokens.css` holds both palettes. Page surfaces consume semantic `--hunch-*` variables; `:root[data-theme="dark"]` assigns the dark palette. Widgets explicitly scope `--mk-*` variables with `.mk-theme-light` and `.mk-theme-dark`, so a host page can show either widget theme independently. The racing and esports widgets follow the app preference. The console integration preview defaults to **Follow app theme** and also accepts explicit Light or Dark overrides.

The header switch first follows the device's `prefers-color-scheme`. An explicit choice persists as `hunch.theme.v1` per origin and syncs with other tabs of that origin. The Vite bootstrap applies the same preference before the app's first paint; the provider updates native `color-scheme` and browser theme color. Blocked storage keeps the current tab usable. Theme changes preserve the provider, selected outcome, stake input, and account state.

**The Action and Place Rule.** Orange identifies actions and prediction selection; lime marks the current place in moss navigation. Keep these roles distinct when extending a screen.

Tonal ramps in the sidecar are synthesized OKLCH metadata for inspection. They are not shipping colors or new theme commitments.

## Typography

**Display Font:** Manrope, with ui-sans-serif, system-ui, and sans-serif fallbacks.
**Body Font:** the same Manrope family.

Manrope is self-hosted as a variable WOFF2 covering weights 400–800, with `font-display: swap`. The asset and OFL license live in `packages/react/src/assets`. The compact, rounded letterforms suit readable application controls; strong headings and tight tracking establish hierarchy without introducing a second display face. Code blocks retain the incumbent monospace treatment.

### Hierarchy

- **Display:** demo page headings use the frontmatter display role; at the demo stacking breakpoints they become 38px.
- **Headline:** dashboard page headings use the headline role; at 760px and below they become 31px.
- **Title:** widget questions use the title role. Integration-card titles use the same size with weight 700 and line-height 1.2.
- **Section:** panels and widget section captions use the section role and real heading elements.
- **Page body / body:** the app root uses the page-body role; the widget and operational rows use the body role. Introductory demo copy is 15px with line-height 1.7; dashboard introductory copy is 14px with line-height 1.7.
- **Label / caption:** buttons use the label role; support copy and pool captions use the caption role. Small contextual metadata in the incumbent implementation also uses 11px.
- **Outcome value:** the outcome-value role uses tabular numerals. The percent sign is 20px, weight 400, and muted.

Paragraphs in the dashboard intro and demo explanatory sections are capped at 65ch where the source establishes it. Headings balance their wrapping; paragraphs use pretty wrapping.

**The Readable Data Rule.** Use tabular numerals for pools, percentages, balances, and countdowns; keep descriptive labels attached to their values.

## Layout

The shared spatial language is aligned rows, fine dividing rules, and room for a working control beside its content. Repeated spacing values are recorded in the frontmatter; they are extracted CSS steps rather than a new mathematical scale.

The dashboard uses a sticky navigation rail (248px) beside a flexible body with `min-width: 0`. The topbar is 78px high. Main content is centered at a maximum width of 1440px with desktop padding of 40px 40px 24px. The stats strip has four columns and horizontal rules. Overview columns use a 1.4-to-1 ratio, a 280px minimum for the second column, and a 28px gap.

Racing and esports main content share a 1440px maximum and 40px 48px top/side padding. Their main split uses a 1.65-to-1 ratio, a 350px minimum widget column, and a 32px gap. Demo application headers are 84px high before mobile wrapping.

Observed responsive behavior:

| Query | Behavior |
| --- | --- |
| Dashboard ≤1200px | Rail becomes 220px; main padding becomes 30px 28px 24px; topbar gutters become 28px. |
| Dashboard ≤1000px | Rail becomes 204px; stats become two columns; overview and integration stack. |
| Dashboard and shared header ≤760px | Rail becomes a static header with four navigation columns; main gutters become 18px; titles and actions stack; topbar wraps. Demo links take a full row. |
| Dashboard ≤760px tables | Each market becomes a grid row with question, status, pool, open action, and both labeled dates retained. Table headings remain available to assistive technology. |
| Demo layouts ≤1100px | Side gutters become 28px; main split uses a flexible column plus 350px widget, with a 24px gap. The header wraps navigation to a full row. |
| Esports ≤850px | Main split stacks; gutters become 18px; heading becomes 38px. |
| Racing ≤800px | Main split and lifecycle stack; gutters become 18px; heading becomes 38px. |
| Small controls ≤480px | Dashboard event metadata and form actions wrap; esports match rows and featured-match details reflow; large team marks become 60px. |
| Widget container ≤300px | Question becomes 21px, outcome value 27px, outcome label 13px, and tile padding 12px 10px. Footer and stake metadata wrap. |

An earlier dashboard ≥1550px padding rule is superseded by the later layout stylesheet; it is not an additional design step. The widget uses an inline-size container query, so its compact behavior follows embed width independently of the page viewport.

## Elevation & Depth

Ordinary work surfaces are flat. White, ivory, moss, and raised moss create depth through tone; one-pixel borders and dividing rules organize data. Neither the shared card nor widget has a resting shadow.

### Shadow Vocabulary

- **Dialog:** `0 20px 60px #0006`, beneath the centered prediction review.
- **Toast:** `0 10px 30px #0004`, beneath transient feedback.

The modal scrim uses `#102a2299`; it belongs to the moss palette.

**The Working Surface Rule.** Ordinary cards stay flat. Use tonal surfaces and fine borders for grouping; reserve shadows for dialogs and toasts.

## Shapes

Corners are restrained and tied to function: controls use the control radius, badges the badge radius, outcome tiles the outcome radius, cards the card radius, and widgets the widget radius. Dialogs use the card radius. Fine borders are normally one pixel. Track ends use the track radius; circular dots are reserved for compact status indicators. Table rows and the esports match list remain straight, divided rows rather than separate rounded cards.

## Components

### Buttons

Direct, compact controls with a clear primary action.

- Shared buttons use label typography, control corners, 9px 14px padding, an 8px icon gap, and a minimum height of 42px.
- Primary fills use the semantic primary color. Light-theme text is white; dark-theme text is the dark background. Secondary fills use the elevated surface and a border; ghost buttons use transparent backgrounds and muted text.
- Hover mixes primary at 12% into the elevated surface for secondary and ghost variants. Primary hover mixes primary at 85% with theme text. Pressed enabled buttons move down 1px. Disabled and busy buttons are disabled, with opacity 0.45.
- Background transitions take 160ms ease-out; the press transform takes 150ms ease-out. Keyboard focus is a 2px primary outline, offset 3px. General app controls use a 4px focus offset.

### Status Badges

Small factual state markers, not competing actions.

A dot accompanies text inside a thin border, with 4px 9px padding, badge corners, 12px text, weight 600, and line-height 1.4. Neutral, success, warning, and primary-colored variants use their semantic variables; the API's legacy `violet` tone now maps to primary orange. Status text stays explicit, including simulated mode.

### Cards / Containers

Quiet containment with tonal boundaries.

Shared cards use the surface, border, and card radius. Padding belongs to the content: common panels use 24px; creation forms use 28px desktop and 22px mobile. Widgets use 24px and the widget radius; compact widgets use 18px. Dark integration cards use raised moss, lighter text, and a moss code inset.

### Inputs / Fields

Readable fields with attached labels and units.

App fields use the theme surface, a one-pixel control border, control corners, 11px 13px padding, and a 44px minimum height. The stake control is a 46px row with 13px horizontal padding, a theme background, and an attached TEST unit. Its input uses numeric input mode and tabular numerals. Focus-within gives the stake wrapper a 2px primary outline, offset 2px. Validation text uses semantic danger, an associated description, and alert semantics; disabled inputs remain native disabled controls.

### Theme Switch

A native button with `role="switch"`, stable accessible name **Dark theme**, and `aria-checked` communicates the selected mode. The visible Light/Dark text and sun/moon icon supplement the track. Enter, Space, and pointer activation all toggle the mode. It uses an elevated surface, control border and corners, a 42px minimum height, 9px 12px padding, and 13px text at weight 650. The 32px by 18px track moves a 12px thumb over 180ms; reduced motion removes the transition. Keyboard focus uses a 2px primary outline with a 3px offset. Header controls wrap on narrow screens.

### Navigation

A stable moss frame with a lime current place.

Dashboard links use navigation corners, 12px padding, an icon/text gap of 10px, and a 46px minimum height. Hover uses raised moss and white text. Active links use lime, moss text, and weight 700. At 760px and below the four primary links form a grid with icons over 12px labels and 42px minimum controls. Shared demo links use light text on moss and a lime underline on the current page.

### Outcome Selector

The signature pairs two equal, native radio choices with their share of the pool.

Each tile uses an elevated surface, control border, outcome radius, and 16px 14px padding; the two-column fieldset has a 10px gap. Choice labels wrap rather than truncate. Selection uses a primary border, the 9% primary/surface mix, primary label text, and an inline SVG checkmark. Hover shifts the border to primary only while enabled. Focus on the native radio outlines its whole tile by 2px with a 3px offset. Closed or pending markets disable the fieldset; winning outcomes have a semantic success border.

The pool track is 7px high. Selecting the second outcome reverses primary and muted track emphasis while the measured proportions stay unchanged. These proportions describe pooled stakes, not odds or a promised payout.

**The Connected Selection Rule.** Selecting an outcome updates its border, checkmark, and pool emphasis together. Color alone must not carry the selected state.

Outcome backgrounds and borders transition over 180ms with `cubic-bezier(0.16, 1, 0.3, 1)`; pool width changes take 240ms with the same easing. Match-row background changes take 180ms. Busy icons spin for 1s linearly; the racing demo's illustrative car animation takes 12s linearly and ends at the lifecycle result.

### Dialogs and Feedback

Prediction review uses the widget theme, a maximum width of 440px constrained to viewport width minus 32px, card corners, and 28px padding. The existing Radix dialog supplies modal semantics, keyboard handling, and focus trapping; closing returns focus to the connected review trigger. Keep its title, description, close action, and confirmation action.

The app reduced-motion rule sets animations and transitions to 0.01ms, one iteration, and automatic scrolling. The shared widget also removes button transitions and busy-icon animation. Carry those rules with new animated components; state must remain readable without movement.

## Do's and Don'ts

### Do:

- **Do** reuse the semantic widget variables so light and dark themes stay coherent.
- **Do** retain visible simulated-demo and Devnet labels beside the relevant controls and receipts.
- **Do** preserve all operational table fields when rows reflow on mobile.
- **Do** use native labeled controls, visible focus, and the connected outcome selection treatment.
- **Do** use the existing inline SVG icon vocabulary and lowercase hunch wordmark.
- **Do** reduce motion with the implemented media query while keeping lifecycle state readable.

### Don't:

- **Don't** replace the working program with decorative timetable framing.
- **Don't** use shipping raster imagery as a substitute for operational content.
- **Don't** add routine card shadows or hard offset shadows to this flat system.
- **Don't** turn dormant legacy eyebrow or kicker styles into new reusable patterns.
- **Don't** present simulated receipts as on-chain transactions.

Recorded from the effective cascade in `packages/react/src/tokens.css`, `packages/react/src/styles.css`, `apps/shared/styles.css`, dashboard styles and layout, and racing/esports styles, plus their shared React controls. Dormant legacy eyebrow/kicker selectors and overridden purple declarations are not canonized; they are inactive implementation residue.

# hunch

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers embedding binary prediction markets in their own applications, and spectators predicting outcomes in racing and esports demonstrations. The initial audience includes HackRU judges evaluating whether the same infrastructure works in different products.

## Product Purpose

hunch provides reusable prediction infrastructure on Solana. A developer creates a market and embeds a React widget. A spectator commits test tokens before the event closes, sees the authorized result, and claims an eligible payout.

## Positioning

The product is an SDK and embeddable component that serves different applications. Solana records prediction pools and settlement; the authorized game server supplies results to a resolver.

## Operating Context

The developer console contains overview, market listings, creation, integration code and preview, and event activity. Separate Velocity Racing and Nexus Invitational demonstrations embed the same widget. Local mock mode lets the frontend run while the contract and live SDK are completed.

## Capabilities and Constraints

React, TypeScript, Vite, npm workspaces, TanStack Query, React Router, Solana Wallet Adapter, and native/Radix controls. Preserve the current prediction, confirmation, claim, race, and market-creation behavior. All tokens are nonredeemable Devnet test tokens or clearly labeled simulated credits; mainnet, purchases, and cash-out are outside scope. Developer C owns frontend code; other developers own the contract, SDK, and resolver. Keep their existing work.

## Brand Commitments

The public app name is **hunch**, lowercase, and the domain is **hunchtrading.tech**. Workspace identifiers retain `@marketkit/*` for integration compatibility. The user delegated the visual redesign direction to the agent after installing Impeccable.

## Evidence on Hand

The working widget, two demonstration applications, developer dashboard, mock fixtures, SDK adapter, and frontend tests. Mock mode must stay visibly labeled; live signatures or confirmations must never be fabricated. Existing uncommitted fixes were present before this redesign.

## Product Principles

- Demonstrate reuse through real working frontend flows.
- Keep the prediction window and transaction state understandable.
- Distinguish simulated data from Devnet data.
- Keep the developer's next action clear.

## Accessibility & Inclusion

Responsive desktop and mobile interfaces, keyboard-accessible controls, readable contrast, visible focus, and reduced-motion support.

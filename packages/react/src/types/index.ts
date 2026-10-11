import type { Outcome, Prediction } from "@hunch/sdk";
export type { Outcome };
export type Mode = "mock" | "sdk";
export interface Market {
  id: string;
  question: string;
  outcomes: [string, string];
  closesAt: number;
  status: "open" | "closed" | "resolved" | "cancelled";
  totalPool: bigint;
  pools: [bigint, bigint];
  winningOutcome: Outcome | null;
  description?: string;
  createdAt?: number;
  application?: string;
}
export interface Position extends Prediction {
  claimed?: boolean;
}
export interface TransactionResult {
  signature: string;
  simulated: boolean;
  status: "submitted" | "confirmed";
}
export interface Claimable {
  amount: bigint;
  claimed: boolean;
}
export interface CreateMarketParams {
  question: string;
  outcomes: [string, string];
  closesAt: number;
  description?: string;
}
export interface MarketEvent {
  id: string;
  marketId: string;
  type:
    | "created"
    | "prediction"
    | "event_received"
    | "signature_verified"
    | "resolution_submitted"
    | "confirmed"
    | "failed"
    | "claim";
  timestamp: number;
  message: string;
  simulated: boolean;
  signature?: string;
}
export interface RaceState {
  marketId: string;
  status: "upcoming" | "racing" | "finished";
  startedAt?: number;
  durationMs: number;
  winner: Outcome | null;
  simulated: boolean;
}

export function formatTokens(value: bigint) {
  return new Intl.NumberFormat("en-US").format(value);
}
export function parseStake(value: string, balance?: bigint): bigint {
  if (!/^\d+$/.test(value.trim()))
    throw new Error("Enter a positive whole number of TEST tokens.");
  const amount = BigInt(value.trim());
  if (amount <= 0n) throw new Error("Your prediction must be at least 1 TEST.");
  if (balance !== undefined && amount > balance)
    throw new Error("This amount exceeds your available TEST balance.");
  return amount;
}
export function poolPercent(pool: bigint, total: bigint) {
  return total === 0n ? 0 : Number((pool * 10000n) / total) / 100;
}
export function effectiveStatus(market: Market, now = Date.now()) {
  return market.status === "open" && now >= market.closesAt * 1000
    ? "closed"
    : market.status;
}
export function explorerUrl(signature: string) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}
export function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

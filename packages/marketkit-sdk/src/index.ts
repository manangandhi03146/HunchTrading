// Preserve the existing frontend SDK contract while exposing the Hunch API.
export * from "@hunch/sdk";
export { MarketKit } from "./client.js";
export type { MarketKitConfig, CreateMarketParams, PredictParams } from "./client.js";
export type { Market, Prediction, Outcome, MarketStatus, GameResultEvent } from "./types.js";

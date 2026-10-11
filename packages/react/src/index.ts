export {
  PredictionMarket,
  type PredictionMarketProps,
} from "./components/PredictionMarket";
export { PredictionMarket as PredictionWidget } from "./components/PredictionMarket";
export {
  HunchProvider,
  useHunch,
  type HunchProviderProps,
} from "./providers/HunchProvider";
export { MockHunchClient, DEMO_WALLET } from "./adapters/MockHunchClient";
export {
  SdkHunchClient,
  type SdkBindings,
  type WalletSigner,
} from "./adapters/SdkHunchClient";
export type { HunchClient } from "./adapters/HunchClient";
export * from "./types";
export * from "./hooks/useMarket";
export * from "./hooks/useMarketPositions";
export { useTransaction } from "./hooks/usePrediction";
export * from "./components/ui";
export { WalletButton, WalletAddress } from "./components/WalletButton";
export { MarketStatus } from "./components/MarketStatus";
import "./styles.css";

export { useNow } from "./hooks/useNow";

export { HttpHunchClient } from "./adapters/HttpHunchClient";

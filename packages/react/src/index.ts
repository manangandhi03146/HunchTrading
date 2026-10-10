export {
  PredictionMarket,
  type PredictionMarketProps,
} from "./components/PredictionMarket";
export { PredictionMarket as PredictionWidget } from "./components/PredictionMarket";
export {
  MarketKitProvider,
  useMarketKit,
  type MarketKitProviderProps,
} from "./providers/MarketKitProvider";
export {
  MockMarketKitClient,
  DEMO_WALLET,
} from "./adapters/MockMarketKitClient";
export {
  SdkMarketKitClient,
  type SdkBindings,
  type WalletSigner,
} from "./adapters/SdkMarketKitClient";
export type { MarketKitClient } from "./adapters/MarketKitClient";
export * from "./types";
export * from "./hooks/useMarket";
export * from "./hooks/useMarketPositions";
export { useTransaction } from "./hooks/usePrediction";
export * from "./components/ui";
export { WalletButton, WalletAddress } from "./components/WalletButton";
export { MarketStatus } from "./components/MarketStatus";
import "./styles.css";

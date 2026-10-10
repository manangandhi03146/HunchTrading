import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ConnectionProvider,
  useConnection,
  useWallet,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";
import {
  MockMarketKitClient,
  DEMO_WALLET,
} from "../adapters/MockMarketKitClient";
import {
  SdkMarketKitClient,
  type SdkBindings,
} from "../adapters/SdkMarketKitClient";
import type { MarketKitClient } from "../adapters/MarketKitClient";
import type { Mode } from "../types";
import "@solana/wallet-adapter-react-ui/styles.css";

interface Context {
  client: MarketKitClient;
  walletAddress: string | null;
  mode: Mode;
  demoConnect: () => void;
  disconnect: () => void;
  notify: (message: string) => void;
}
const MarketKitContext = createContext<Context | null>(null);
export function useMarketKit() {
  const context = useContext(MarketKitContext);
  if (!context)
    throw new Error("Wrap your application in <MarketKitProvider>.");
  return context;
}
export interface MarketKitProviderProps extends PropsWithChildren {
  mode?: Mode;
  client?: MarketKitClient;
  programId?: string;
  tokenMint?: string;
  rpcUrl?: string;
  sdkBindings?: SdkBindings;
  defaultDemoConnected?: boolean;
}
function Session({
  children,
  mode = "mock",
  client: supplied,
  programId,
  tokenMint,
  sdkBindings,
  defaultDemoConnected = false,
}: MarketKitProviderProps) {
  const wallet = useWallet();
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const { connection } = useConnection();
  const [demoConnected, setDemoConnected] = useState(defaultDemoConnected);
  const [toast, setToast] = useState("");
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 1000, refetchOnWindowFocus: true },
        },
      }),
  );
  const client = useMemo<MarketKitClient>(
    () =>
      supplied ??
      (mode === "mock"
        ? new MockMarketKitClient()
        : new SdkMarketKitClient({
            connection,
            programId,
            tokenMint,
            bindings: sdkBindings,
            getWallet: () => walletRef.current,
          })),
    [supplied, mode, connection, programId, tokenMint, sdkBindings],
  );
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(
    () =>
      client.subscribe?.(() => {
        void queryClient.invalidateQueries();
      }),
    [client, queryClient],
  );
  const value = useMemo<Context>(
    () => ({
      client,
      mode: client.mode,
      walletAddress:
        client.mode === "mock"
          ? demoConnected
            ? DEMO_WALLET
            : null
          : (wallet.publicKey?.toBase58() ?? null),
      demoConnect: () => setDemoConnected(true),
      disconnect: () => {
        if (client.mode === "mock") setDemoConnected(false);
        else
          void wallet
            .disconnect()
            .catch((error) =>
              notify(
                error instanceof Error
                  ? error.message
                  : "Wallet disconnect failed.",
              ),
            );
      },
      notify,
    }),
    [client, demoConnected, wallet, notify],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MarketKitContext.Provider value={value}>
        {children}
        <div className="mk-toast" role="status" aria-live="polite">
          {toast && <span>{toast}</span>}
        </div>
      </MarketKitContext.Provider>
    </QueryClientProvider>
  );
}
export function MarketKitProvider(props: MarketKitProviderProps) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
    ],
    [],
  );
  const [walletError, setWalletError] = useState("");
  return (
    <ConnectionProvider endpoint={props.rpcUrl ?? clusterApiUrl("devnet")}>
      <WalletProvider
        wallets={wallets}
        autoConnect={props.mode === "sdk" || props.client?.mode === "sdk"}
        onError={(error) => setWalletError(error.message)}
      >
        <WalletModalProvider>
          <Session {...props}>
            {walletError && (
              <div className="mk-wallet-error" role="alert">
                {walletError}
                <button
                  onClick={() => setWalletError("")}
                  aria-label="Dismiss wallet error"
                >
                  ×
                </button>
              </div>
            )}
            {props.children}
          </Session>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

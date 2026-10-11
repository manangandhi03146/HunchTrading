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
import { MockHunchClient, DEMO_WALLET } from "../adapters/MockHunchClient";
import { SdkHunchClient, type SdkBindings } from "../adapters/SdkHunchClient";
import type { HunchClient } from "../adapters/HunchClient";
import type { Mode } from "../types";
import "@solana/wallet-adapter-react-ui/styles.css";

interface Context {
  client: HunchClient;
  walletAddress: string | null;
  mode: Mode;
  demoConnect: () => void;
  disconnect: () => void;
  notify: (message: string) => void;
}
const HunchContext = createContext<Context | null>(null);
let nextQueryScope = 0;
export function useHunch() {
  const context = useContext(HunchContext);
  if (!context) throw new Error("Wrap your application in <HunchProvider>.");
  return context;
}
export interface HunchProviderProps extends PropsWithChildren {
  mode?: Mode;
  client?: HunchClient;
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
}: HunchProviderProps) {
  const wallet = useWallet();
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const { connection } = useConnection();
  const [demoConnected, setDemoConnected] = useState(defaultDemoConnected);
  const [toast, setToast] = useState("");
  const client = useMemo<HunchClient>(
    () =>
      supplied ??
      (mode === "mock"
        ? new MockHunchClient()
        : new SdkHunchClient({
            connection,
            programId,
            tokenMint,
            bindings: sdkBindings,
            getWallet: () => walletRef.current,
          })),
    [supplied, mode, connection, programId, tokenMint, sdkBindings],
  );
  // A replacement client may point at a different program, RPC, mint, or store.
  // Remount query consumers as well so in-flight reads cannot cross sessions.
  const { queryClient, queryScope } = useMemo(
    () => ({
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 1000, refetchOnWindowFocus: true },
        },
      }),
      queryScope: ++nextQueryScope,
    }),
    [client],
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
            ? (client.demoWalletAddress ?? DEMO_WALLET)
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
    <QueryClientProvider key={queryScope} client={queryClient}>
      <HunchContext.Provider value={value}>
        {children}
        <div className="hunch-toast" role="status" aria-live="polite">
          {toast && <span>{toast}</span>}
        </div>
      </HunchContext.Provider>
    </QueryClientProvider>
  );
}
export function HunchProvider(props: HunchProviderProps) {
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
              <div className="hunch-wallet-error" role="alert">
                {walletError}
                <button
                  type="button"
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

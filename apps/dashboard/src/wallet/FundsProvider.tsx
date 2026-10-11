import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  AIRDROP_LAMPORTS,
  loadReceipts,
  prepareTransfer,
  receiptStatus,
  requireDevnet,
  sendTransfer,
  type FundsReceipt,
  type TransferQuote,
} from "./transactions";

function useFundsState() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const owner = wallet.publicKey?.toBase58() ?? null;
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  const storageKey = `hunch:devnet-funds:v1:${connection.rpcEndpoint}`;
  const [records, setRecords] = useState(() => {
    try {
      return {
        key: storageKey,
        receipts: loadReceipts(localStorage.getItem(storageKey)),
      };
    } catch {
      return { key: storageKey, receipts: [] as FundsReceipt[] };
    }
  });
  const receipts =
    records.key === storageKey ? records.receipts : loadReceipts(null);
  const recordsRef = useRef({ key: storageKey, receipts });
  recordsRef.current = { key: storageKey, receipts };
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const balance = useQuery({
    queryKey: ["devnet-funds", connection.rpcEndpoint, owner],
    enabled: !!owner,
    queryFn: async () => {
      await requireDevnet(connection);
      return connection.getBalance(new PublicKey(owner!), "confirmed");
    },
    refetchInterval: 15_000,
    retry: false,
  });
  function save(receipt: FundsReceipt) {
    const previous =
      recordsRef.current.key === storageKey ? recordsRef.current.receipts : [];
    const next = [
      receipt,
      ...previous.filter((r) => r.signature !== receipt.signature),
    ].slice(0, 50);
    // Public receipts only. Do not broadcast when a receipt cannot be retained for reconciliation.
    localStorage.setItem(storageKey, JSON.stringify(next));
    recordsRef.current = { key: storageKey, receipts: next };
    setRecords(recordsRef.current);
  }
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["devnet-funds"] });
    await queryClient.invalidateQueries({ queryKey: ["balance"] });
    await queryClient.invalidateQueries({ queryKey: ["devnet-test"] });
  }
  async function operation(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Funds operation could not complete.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function assertReady(expected = owner) {
    if (!expected || !wallet.publicKey || activeOwner.current !== expected)
      throw new Error("Connect the same Devnet wallet and review again.");
    if (
      recordsRef.current.receipts.some(
        (r) => r.owner === expected && r.status === "pending",
      )
    )
      throw new Error(
        "Check your pending receipt before making another funds request. It will not be resent automatically.",
      );
  }
  return {
    owner,
    balance,
    busy,
    message,
    receipts: receipts.filter((r) => r.owner === owner),
    refresh,
    async review(recipient: string, amount: string) {
      assertReady();
      const quote = await prepareTransfer(
        connection,
        wallet.publicKey!,
        recipient,
        amount,
      );
      assertReady(quote.owner);
      return quote;
    },
    send(quote: TransferQuote) {
      return operation(async () => {
        assertReady(quote.owner);
        if (!wallet.signTransaction)
          throw new Error(
            "This wallet cannot sign a transfer. Use Phantom or Solflare.",
          );
        const result = await sendTransfer(
          connection,
          quote,
          async (tx) => {
            assertReady(quote.owner);
            return wallet.signTransaction!(tx);
          },
          (receipt) => {
            save(receipt);
            setMessage("Signed transfer saved. Waiting for Devnet confirmation…");
          },
        );
        save(result);
        setMessage(
          result.status === "confirmed"
            ? "Transfer confirmed on Solana Devnet."
            : "Devnet rejected this transaction. Inspect the receipt for details.",
        );
        await refresh();
      });
    },
    airdrop() {
      return operation(async () => {
        assertReady();
        // Ensure browser storage is available before asking the faucet to mutate funds.
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify(recordsRef.current.receipts),
          );
        } catch {
          throw new Error(
            "Enable browser storage so this site can retain a Devnet receipt before requesting funds.",
          );
        }
        await requireDevnet(connection);
        assertReady();
        const recipient = wallet.publicKey!;
        const signature = await connection.requestAirdrop(
          recipient,
          AIRDROP_LAMPORTS,
        );
        const receipt: FundsReceipt = {
          signature,
          owner: recipient.toBase58(),
          recipient: recipient.toBase58(),
          lamports: AIRDROP_LAMPORTS,
          kind: "airdrop",
          status: "pending",
          createdAt: Date.now(),
        };
        save(receipt);
        setMessage("Airdrop submitted. Checking Devnet confirmation…");
        // Poll status only. No automatic repeat of a faucet request.
        for (let i = 0; i < 12; i++) {
          const checked = await receiptStatus(connection, receipt);
          if (checked.status !== "pending") {
            save(checked);
            setMessage(
              checked.status === "confirmed"
                ? "0.1 Devnet SOL added to your wallet."
                : "The airdrop failed. Inspect its receipt.",
            );
            await refresh();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        setMessage(
          "Airdrop confirmation is pending. Check its receipt before requesting again.",
        );
      });
    },
    check(receipt: FundsReceipt) {
      return operation(async () => {
        const result = await receiptStatus(connection, receipt);
        save(result);
        await refresh();
        setMessage(
          result.status === "pending"
            ? "Devnet has not confirmed this signature. Check Explorer and the wallet’s activity before any retry."
            : `Transaction ${result.status} on Devnet.`,
        );
      });
    },
  };
}
const Context = createContext<ReturnType<typeof useFundsState> | null>(null);
export function FundsProvider({ children }: { children: ReactNode }) {
  const value = useFundsState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useFunds() {
  const context = useContext(Context);
  if (!context) throw new Error("FundsProvider is required.");
  return context;
}

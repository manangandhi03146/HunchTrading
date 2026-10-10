import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useHunch } from "../providers/HunchProvider";
import type { TransactionResult } from "../types";

export function useTransaction<T>(
  operation: (params: T) => Promise<TransactionResult>,
) {
  const { client, notify } = useHunch();
  const queryClient = useQueryClient();
  const lock = useRef(false);
  const [receipt, setReceipt] = useState<TransactionResult | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "signing" | "confirming" | "confirmed" | "failed"
  >("idle");
  const mutation = useMutation({
    mutationFn: async (params: T) => {
      setReceipt(null);
      setPhase("signing");
      const result = await operation(params);
      setReceipt(result);
      setPhase("confirming");
      const confirmed = await client.confirmTransaction(result);
      setReceipt(confirmed);
      return confirmed;
    },
    onSuccess: () => {
      setPhase("confirmed");
      notify(
        client.mode === "mock"
          ? "Demo action completed · no blockchain transaction"
          : "Transaction confirmed on Solana Devnet.",
      );
      void queryClient.invalidateQueries();
    },
    onError: () => setPhase("failed"),
    onSettled: () => {
      lock.current = false;
    },
  });
  const execute = async (params: T) => {
    if (lock.current) return;
    lock.current = true;
    try {
      return await mutation.mutateAsync(params);
    } finally {
      lock.current = false;
    }
  };
  return { ...mutation, execute, receipt, phase };
}

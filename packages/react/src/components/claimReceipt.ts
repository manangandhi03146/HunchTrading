import type { TransactionResult } from "../types";

export interface ClaimReceipt {
  amount: string;
  transaction: TransactionResult;
}

// Only public, confirmed receipt metadata is stored. This is a local history aid,
// never a source of truth for eligibility or an authorization to claim again.
export function readClaimReceipt(key: string): ClaimReceipt | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value.amount === "string" &&
      /^\d+$/.test(value.amount) &&
      typeof value.transaction?.signature === "string" &&
      value.transaction.status === "confirmed" &&
      typeof value.transaction.simulated === "boolean"
    )
      return value;
  } catch {
    // Blocked storage or an invalid saved record must not interrupt the widget.
  }
  return null;
}

export function saveClaimReceipt(key: string, receipt: ClaimReceipt) {
  if (receipt.transaction.status !== "confirmed") return;
  try {
    localStorage.setItem(key, JSON.stringify(receipt));
  } catch {
    // The current mounted widget still keeps the receipt in memory.
  }
}

import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import bs58 from "bs58";
import { HUNCH_DEVNET_GENESIS_HASH } from "@hunch/sdk";

export const SOL_LAMPORTS = 1_000_000_000;
export const AIRDROP_LAMPORTS = 100_000_000;
export type FundsReceipt = {
  signature: string;
  owner: string;
  recipient: string;
  lamports: number;
  kind: "send" | "airdrop";
  status: "pending" | "confirmed" | "failed";
  createdAt: number;
};
export type TransferQuote = {
  transaction: Transaction;
  owner: string;
  recipient: string;
  lamports: number;
  fee: number;
  balance: number;
  blockhash: string;
  lastValidBlockHeight: number;
};
export function parseSol(value: string): number {
  if (!/^\d+(\.\d{1,9})?$/.test(value))
    throw new Error(
      "Enter a positive SOL amount with at most nine decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const exact =
    BigInt(whole) * BigInt(SOL_LAMPORTS) + BigInt(fraction.padEnd(9, "0"));
  if (exact <= 0n || exact > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Enter a positive SOL amount within the supported range.");
  return Number(exact);
}
export function formatSol(lamports: number) {
  return (lamports / SOL_LAMPORTS).toLocaleString(undefined, {
    maximumFractionDigits: 9,
  });
}
export function recipientKey(value: string, owner: PublicKey) {
  let key: PublicKey;
  try {
    key = new PublicKey(value.trim());
  } catch {
    throw new Error("Enter a valid Solana wallet address.");
  }
  if (!PublicKey.isOnCurve(key.toBytes()))
    throw new Error(
      "Use a wallet address, rather than a program or vault address.",
    );
  if (key.equals(owner))
    throw new Error("The recipient must be a different wallet.");
  return key;
}
export async function requireDevnet(connection: Connection) {
  if ((await connection.getGenesisHash()) !== HUNCH_DEVNET_GENESIS_HASH)
    throw new Error(
      "This RPC is not Solana Devnet. Funds operations are blocked.",
    );
}
export async function prepareTransfer(
  connection: Connection,
  owner: PublicKey,
  recipient: string,
  amount: string,
): Promise<TransferQuote> {
  const to = recipientKey(recipient, owner);
  const lamports = parseSol(amount);
  await requireDevnet(connection);
  const [latest, balance, account, minimum] = await Promise.all([
    connection.getLatestBlockhash("confirmed"),
    connection.getBalance(owner, "confirmed"),
    connection.getAccountInfo(to, "confirmed"),
    connection.getMinimumBalanceForRentExemption(0, "confirmed"),
  ]);
  if (
    account &&
    (account.executable ||
      !account.owner.equals(SystemProgram.programId) ||
      account.data.length)
  )
    throw new Error(
      "This recipient is not a plain SOL wallet. Check the destination address.",
    );
  if ((account?.lamports ?? 0) + lamports < minimum)
    throw new Error(
      `A new wallet needs at least ${formatSol(minimum)} SOL to remain rent exempt.`,
    );
  const transaction = new Transaction({ feePayer: owner, ...latest }).add(
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: to, lamports }),
  );
  const fee = (
    await connection.getFeeForMessage(transaction.compileMessage(), "confirmed")
  ).value;
  if (fee === null || !Number.isSafeInteger(fee) || fee < 0)
    throw new Error(
      "Could not quote the network fee. Review again before sending.",
    );
  if (lamports > balance - fee)
    throw new Error("Insufficient Devnet SOL, including the network fee.");
  const remaining = balance - fee - lamports;
  if (remaining !== 0 && remaining < minimum)
    throw new Error(
      `Keep at least ${formatSol(minimum)} SOL in the source wallet, or send its full balance minus fees.`,
    );
  return {
    transaction,
    owner: owner.toBase58(),
    recipient: to.toBase58(),
    lamports,
    fee,
    balance,
    ...latest,
  };
}
export async function sendTransfer(
  connection: Connection,
  quote: TransferQuote,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  onSigned: (receipt: FundsReceipt) => void,
) {
  await requireDevnet(connection);
  if (
    (await connection.getBlockHeight("confirmed")) > quote.lastValidBlockHeight
  )
    throw new Error("This quote expired. Review the transfer again.");
  if (
    (await connection.getBalance(new PublicKey(quote.owner), "confirmed")) <
    quote.lamports + quote.fee
  )
    throw new Error("Your balance changed. Review the transfer again.");
  const originalMessage = quote.transaction.serializeMessage();
  const signed = await signTransaction(quote.transaction);
  const message = signed.serializeMessage();
  if (
    message.length !== originalMessage.length ||
    message.some((b, i) => b !== originalMessage[i]) ||
    !signed.verifySignatures() ||
    !signed.signature
  )
    throw new Error(
      "The wallet returned a different or invalid transaction. Nothing was submitted.",
    );
  const signature = bs58.encode(signed.signature);
  const receipt: FundsReceipt = {
    signature,
    owner: quote.owner,
    recipient: quote.recipient,
    lamports: quote.lamports,
    kind: "send",
    status: "pending",
    createdAt: Date.now(),
  };
  // Persist the known signature before any broadcast. A timeout never triggers a second send.
  onSigned(receipt);
  const returned = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 0,
  });
  if (returned !== signature)
    throw new Error(
      "RPC returned an unexpected signature. Check the saved receipt before continuing.",
    );
  const confirmed = await connection.confirmTransaction(
    {
      signature,
      blockhash: quote.blockhash,
      lastValidBlockHeight: quote.lastValidBlockHeight,
    },
    "confirmed",
  );
  return {
    ...receipt,
    status: confirmed.value.err ? "failed" : "confirmed",
  } as FundsReceipt;
}
export async function receiptStatus(
  connection: Connection,
  receipt: FundsReceipt,
): Promise<FundsReceipt> {
  await requireDevnet(connection);
  const result = (
    await connection.getSignatureStatuses([receipt.signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  const status = result?.err
    ? "failed"
    : result &&
        (result.confirmationStatus === "confirmed" ||
          result.confirmationStatus === "finalized")
      ? "confirmed"
      : "pending";
  return { ...receipt, status };
}
export function loadReceipts(raw: string | null): FundsReceipt[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is FundsReceipt => {
        try {
          if (!r || typeof r !== "object") return false;
          const x = r as FundsReceipt;
          return (
            typeof x.signature === "string" &&
            bs58.decode(x.signature).length === 64 &&
            !!new PublicKey(x.owner) &&
            !!new PublicKey(x.recipient) &&
            Number.isSafeInteger(x.lamports) &&
            x.lamports > 0 &&
            (x.kind === "send" || x.kind === "airdrop") &&
            ["pending", "confirmed", "failed"].includes(x.status) &&
            Number.isSafeInteger(x.createdAt)
          );
        } catch {
          return false;
        }
      })
      .slice(0, 50);
  } catch {
    return [];
  }
}

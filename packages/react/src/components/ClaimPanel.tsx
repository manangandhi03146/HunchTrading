import { Trophy, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useClaimable } from "../hooks/useMarketPositions";
import { useHunch } from "../providers/HunchProvider";
import { useTransaction } from "../hooks/usePrediction";
import { formatTokens, type Market } from "../types";
import { Button, ErrorState, TransactionLink } from "./ui";
import { WalletButton } from "./WalletButton";
import {
  readClaimReceipt,
  saveClaimReceipt,
  type ClaimReceipt,
} from "./claimReceipt";
export function ClaimPanel({
  market,
  onError,
  showWalletButton = true,
}: {
  market: Market;
  onError?: (error: Error) => void;
  showWalletButton?: boolean;
}) {
  const { walletAddress, client } = useHunch();
  const claimable = useClaimable(market.id, true);
  const receiptKey = `hunch.claim.v1:${JSON.stringify([client.mode, client.programId ?? "local", market.id, walletAddress])}`;
  const [savedReceipt, setSavedReceipt] = useState<ClaimReceipt | null>(() =>
    readClaimReceipt(receiptKey),
  );
  useEffect(
    () => setSavedReceipt(readClaimReceipt(receiptKey)),
    [receiptKey, client],
  );
  const transaction = useTransaction(async () =>
    client.claimWinnings({
      marketId: market.id,
      outcome: market.winningOutcome ?? 0,
      walletAddress: walletAddress!,
    }),
  );
  return (
    <div className="hunch-claim">
      <div className="hunch-claim-heading">
        <Trophy size={19} />
        <div>
          <small>
            {market.status === "cancelled"
              ? "Market cancelled"
              : "Market settled"}
          </small>
          <strong>
            {market.status === "cancelled"
              ? "Eligible stakes can be refunded"
              : `${market.outcomes[market.winningOutcome ?? 0]} wins`}
          </strong>
        </div>
      </div>
      {!walletAddress ? (
        <>
          <p>Connect your account to check your position.</p>
          {showWalletButton && <WalletButton />}
        </>
      ) : (
        <>
          <div className="hunch-claim-amount">
            <span>
              {claimable.data?.claimed
                ? "Remaining to claim"
                : market.status === "cancelled"
                  ? "Refund available"
                  : "Your claimable amount"}
            </span>
            <strong>
              {claimable.isPending
                ? "…"
                : claimable.data
                  ? `${formatTokens(claimable.data.amount)} TEST`
                  : "Unavailable"}
            </strong>
          </div>
          {claimable.error && (
            <ErrorState
              error={claimable.error}
              retry={() => {
                void claimable.refetch();
              }}
            />
          )}
          <Button
            className="hunch-full"
            disabled={
              !claimable.data ||
              claimable.data.claimed ||
              claimable.data.amount === 0n
            }
            busy={transaction.isPending}
            onClick={() => {
              const amount = claimable.data?.amount;
              void transaction
                .execute(undefined)
                .then((receipt) => {
                  if (
                    !receipt ||
                    receipt.status !== "confirmed" ||
                    amount === undefined
                  )
                    return;
                  const record = {
                    amount: amount.toString(),
                    transaction: receipt,
                  };
                  setSavedReceipt(record);
                  saveClaimReceipt(receiptKey, record);
                })
                .catch((error) =>
                  onError?.(
                    error instanceof Error ? error : new Error(String(error)),
                  ),
                );
            }}
          >
            {claimable.data?.claimed ? (
              <>
                <CheckCircle2 size={16} /> Already claimed
              </>
            ) : transaction.isPending ? (
              "Confirming claim…"
            ) : market.status === "cancelled" ? (
              "Claim refund"
            ) : (
              "Claim winnings"
            )}
          </Button>
          {claimable.data?.amount === 0n && !claimable.data.claimed && (
            <p>You have no eligible unclaimed position.</p>
          )}
          {transaction.error && <ErrorState error={transaction.error} />}
          {claimable.data?.claimed && (
            <div className="hunch-claim-history" role="status">
              <strong>
                {savedReceipt
                  ? `${savedReceipt.transaction.simulated ? "Simulated" : "Confirmed"} ${market.status === "cancelled" ? "refund" : "payout"}: ${formatTokens(BigInt(savedReceipt.amount))} TEST`
                  : "Claim completed. No tokens remain to claim."}
              </strong>
              {savedReceipt && (
                <p>
                  Receipt saved on this device. Eligibility is checked against
                  your current position.
                </p>
              )}
            </div>
          )}
          {(transaction.receipt ||
            (claimable.data?.claimed && savedReceipt)) && (
            <TransactionLink
              result={transaction.receipt ?? savedReceipt!.transaction}
            />
          )}
        </>
      )}
    </div>
  );
}

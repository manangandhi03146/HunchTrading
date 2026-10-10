import { Trophy, CheckCircle2 } from "lucide-react";
import { useClaimable } from "../hooks/useMarketPositions";
import { useMarketKit } from "../providers/MarketKitProvider";
import { useTransaction } from "../hooks/usePrediction";
import { formatTokens, type Market } from "../types";
import { Button, ErrorState, TransactionLink } from "./ui";
import { WalletButton } from "./WalletButton";
export function ClaimPanel({
  market,
  onError,
}: {
  market: Market;
  onError?: (error: Error) => void;
}) {
  const { walletAddress, client } = useMarketKit();
  const claimable = useClaimable(market.id, true);
  const transaction = useTransaction(async () =>
    client.claimWinnings({
      marketId: market.id,
      outcome: market.winningOutcome ?? 0,
      walletAddress: walletAddress!,
    }),
  );
  return (
    <div className="mk-claim">
      <div className="mk-claim-heading">
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
          <WalletButton />
        </>
      ) : (
        <>
          <div className="mk-claim-amount">
            <span>
              {claimable.data?.claimed
                ? "Already claimed"
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
            className="mk-full"
            disabled={
              !claimable.data ||
              claimable.data.claimed ||
              claimable.data.amount === 0n
            }
            busy={transaction.isPending}
            onClick={() => {
              void transaction
                .execute(undefined)
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
          {transaction.receipt && (
            <TransactionLink result={transaction.receipt} />
          )}
        </>
      )}
    </div>
  );
}

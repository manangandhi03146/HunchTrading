import { useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Clock3, ShieldCheck, X } from "lucide-react";
import { useMarket } from "../hooks/useMarket";
import { useNow } from "../hooks/useNow";
import { useBalance } from "../hooks/useMarket";
import { useMarketPositions } from "../hooks/useMarketPositions";
import { useTransaction } from "../hooks/usePrediction";
import { useHunch } from "../providers/HunchProvider";
import {
  effectiveStatus,
  formatTokens,
  parseStake,
  type Outcome,
} from "../types";
import { Button, cn, ErrorState, Logo, Skeleton, TransactionLink } from "./ui";
import { OutcomeSelector } from "./OutcomeSelector";
import { StakeInput } from "./StakeInput";
import { PoolDistribution } from "./PoolDistribution";
import { MarketStatus } from "./MarketStatus";
import { ClaimPanel } from "./ClaimPanel";
import { WalletButton, WalletAddress } from "./WalletButton";

export interface PredictionMarketProps {
  marketId: string;
  theme?: "dark" | "light";
  variant?: "default" | "compact";
  showPool?: boolean;
  showWalletButton?: boolean;
  className?: string;
  onPredictionSuccess?: (signature: string) => void;
  onError?: (error: Error) => void;
}
export function PredictionMarket(props: PredictionMarketProps) {
  const { walletAddress } = useHunch();
  return (
    <PredictionMarketContent
      key={`${props.marketId}:${walletAddress}`}
      {...props}
    />
  );
}
function PredictionMarketContent({
  marketId,
  theme = "dark",
  variant = "default",
  showPool = true,
  showWalletButton = true,
  className,
  onPredictionSuccess,
  onError,
}: PredictionMarketProps) {
  const { client, walletAddress, mode } = useHunch();
  const marketQuery = useMarket(marketId);
  const balance = useBalance();
  const positions = useMarketPositions(marketId);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [amount, setAmount] = useState("10");
  const [fieldError, setFieldError] = useState("");
  const [review, setReview] = useState(false);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const now = useNow();
  const id = useId();
  useEffect(() => {
    setOutcome(null);
    setReview(false);
    setFieldError("");
  }, [marketId, walletAddress]);
  const transaction = useTransaction(
    async (params: { outcome: Outcome; amount: bigint }) =>
      client.predict({ marketId, ...params, walletAddress: walletAddress! }),
  );
  const market = marketQuery.data;
  const status = market ? effectiveStatus(market, now) : "closed";
  const seconds = market
    ? Math.max(0, Math.ceil((market.closesAt * 1000 - now) / 1000))
    : 0;
  const countdown =
    seconds >= 3600
      ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
      : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const validate = () => {
    try {
      if (outcome === null)
        throw new Error("Choose an outcome before continuing.");
      if (balance.isError)
        throw new Error("Refresh your TEST balance before confirming.");
      if (balance.data === undefined)
        throw new Error("Wait until your TEST balance is available.");
      const stake = parseStake(amount, balance.data);
      setFieldError("");
      return stake;
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  const submit = async () => {
    const stake = validate();
    if (!stake || outcome === null || status !== "open" || !walletAddress)
      return;
    setReview(false);
    try {
      const result = await transaction.execute({ outcome, amount: stake });
      if (result) onPredictionSuccess?.(result.signature);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  return (
    <section
      className={cn(
        "hunch-widget",
        `hunch-theme-${theme}`,
        variant === "compact" && "hunch-widget-compact",
        className,
      )}
      aria-label="Prediction market"
    >
      <div className="hunch-widget-top">
        <Logo small />
        {market && <MarketStatus status={status} />}
      </div>
      {mode === "mock" && (
        <div className="hunch-simulation">
          SIMULATED DEMO · NO ON-CHAIN TRANSACTIONS
        </div>
      )}
      {marketQuery.isPending ? (
        <Skeleton />
      ) : marketQuery.error ? (
        <ErrorState
          error={marketQuery.error}
          retry={() => {
            void marketQuery.refetch();
          }}
        />
      ) : (
        market && (
          <>
            <div className="hunch-question">
              <h2>{market.question}</h2>
              <span>
                <Clock3 size={13} />
                {status === "open"
                  ? `Closes in ${countdown}`
                  : status === "closed"
                    ? "Predictions closed"
                    : "Results are final"}
              </span>
            </div>
            <OutcomeSelector
              market={market}
              value={outcome}
              onChange={(value) => {
                setOutcome(value);
                setFieldError("");
              }}
              disabled={status !== "open" || transaction.isPending}
              name={`${id}-outcome`}
            />
            <PoolDistribution market={market} showPool={showPool} />
            {status === "resolved" || status === "cancelled" ? (
              <ClaimPanel
                key={`${marketId}:${walletAddress}`}
                market={market}
                onError={onError}
                showWalletButton={showWalletButton}
              />
            ) : status === "closed" ? (
              <div className="hunch-waiting">
                <Clock3 size={22} />
                <strong>Waiting for the official result</strong>
                <p>
                  New predictions are closed. Settlement follows the authorized
                  game-server event.
                </p>
              </div>
            ) : (
              <>
                <StakeInput
                  id={`${id}-stake`}
                  value={amount}
                  onChange={(value) => {
                    setAmount(value);
                    setFieldError("");
                  }}
                  balance={balance.data}
                  balancePending={balance.isPending}
                  error={fieldError}
                  disabled={transaction.isPending}
                />
                {balance.error && (
                  <ErrorState
                    error={balance.error}
                    retry={() => {
                      void balance.refetch();
                    }}
                  />
                )}
                {!walletAddress ? (
                  <div className="hunch-connect">
                    <p>
                      {mode === "mock"
                        ? "Try the complete flow with a simulated account."
                        : "Connect a Solana wallet to predict with Devnet TEST."}
                    </p>
                    {showWalletButton && <WalletButton />}
                  </div>
                ) : (
                  <>
                    <Button
                      className="hunch-full"
                      disabled={balance.data === undefined || balance.isError}
                      busy={transaction.isPending}
                      onClick={(event) => {
                        if (validate() !== null) {
                          reviewTrigger.current = event.currentTarget;
                          setReview(true);
                        }
                      }}
                    >
                      {transaction.phase === "confirming" ? (
                        "Awaiting confirmation…"
                      ) : transaction.isPending ? (
                        "Submitting prediction…"
                      ) : (
                        <>
                          Review prediction <ArrowRight size={16} />
                        </>
                      )}
                    </Button>
                    <div className="hunch-account">
                      <WalletAddress />
                      <span>
                        {positions.data?.reduce((sum, p) => sum + p.amount, 0n)
                          ? `${formatTokens(positions.data.reduce((sum, p) => sum + p.amount, 0n))} TEST committed`
                          : "No position yet"}
                      </span>
                      {showWalletButton && <WalletButton />}
                    </div>
                  </>
                )}
              </>
            )}
            {transaction.error && <ErrorState error={transaction.error} />}
            {transaction.receipt && (
              <div className="hunch-transaction" role="status">
                <strong>
                  {transaction.phase === "confirmed"
                    ? mode === "mock"
                      ? "Demo prediction recorded"
                      : "Prediction confirmed"
                    : transaction.phase === "failed"
                      ? "Check transaction status before retrying"
                      : "Transaction submitted · confirming"}
                </strong>
                <TransactionLink result={transaction.receipt} />
              </div>
            )}
            <footer className="hunch-widget-footer">
              <ShieldCheck size={13} />
              {mode === "mock"
                ? "Nonredeemable demo credits"
                : "Solana Devnet · nonredeemable test tokens"}
              <span>Powered by hunch</span>
            </footer>
            <Dialog.Root open={review} onOpenChange={setReview}>
              <Dialog.Portal>
                <Dialog.Overlay className="hunch-dialog-overlay" />
                <Dialog.Content
                  className={cn("hunch-dialog", `hunch-theme-${theme}`)}
                  onCloseAutoFocus={(event) => {
                    if (reviewTrigger.current?.isConnected) {
                      event.preventDefault();
                      reviewTrigger.current.focus();
                    }
                  }}
                >
                  <Dialog.Title>Review your prediction</Dialog.Title>
                  <Dialog.Description>
                    Commit {amount} TEST to{" "}
                    {outcome === null
                      ? "your selected outcome"
                      : market.outcomes[outcome]}
                    .{" "}
                    {mode === "mock"
                      ? "This is a simulation with no blockchain transaction."
                      : "Your wallet will ask you to sign a Devnet transaction."}{" "}
                    Final payouts depend on the closed pool.
                  </Dialog.Description>
                  {fieldError && (
                    <p className="hunch-field-error" role="alert">
                      {fieldError}
                    </p>
                  )}
                  <div className="hunch-dialog-actions">
                    <Dialog.Close asChild>
                      <Button variant="secondary">Go back</Button>
                    </Dialog.Close>
                    <Button
                      disabled={status !== "open" || transaction.isPending}
                      onClick={() => {
                        void submit();
                      }}
                    >
                      Confirm prediction
                    </Button>
                  </div>
                  {status !== "open" && (
                    <p className="hunch-field-error">
                      Predictions closed while you were reviewing.
                    </p>
                  )}
                  <Dialog.Close
                    className="hunch-dialog-close"
                    aria-label="Close prediction review"
                  >
                    <X size={18} />
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </>
        )
      )}
    </section>
  );
}

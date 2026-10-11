import { formatTokens, poolPercent, type Market } from "../types";
export function PoolDistribution({
  market,
  showPool = true,
}: {
  market: Market;
  showPool?: boolean;
}) {
  const percent = poolPercent(market.pools[0], market.totalPool);
  return (
    <div className="hunch-pool">
      <div className="hunch-distribution-head">
        <span>Pool distribution</span>
        {showPool && (
          <strong>
            {formatTokens(market.totalPool)} <small>TEST</small>
          </strong>
        )}
      </div>
      <div
        className="hunch-distribution-track"
        role="img"
        aria-label={
          market.totalPool === 0n
            ? "No stakes yet"
            : `${market.outcomes[0]} ${percent} percent; ${market.outcomes[1]} ${poolPercent(market.pools[1], market.totalPool)} percent`
        }
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>
        {market.totalPool === 0n
          ? "No stakes yet. Pool shares appear after the first prediction."
          : "Shares of pooled stakes. Final payouts depend on the closed pool."}
      </p>
    </div>
  );
}

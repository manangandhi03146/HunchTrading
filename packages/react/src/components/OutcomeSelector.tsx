import { Check } from "lucide-react";
import { cn } from "./ui";
import { poolPercent, type Market, type Outcome } from "../types";
export function OutcomeSelector({
  market,
  value,
  onChange,
  disabled,
  name,
}: {
  market: Market;
  value: Outcome | null;
  onChange: (outcome: Outcome) => void;
  disabled: boolean;
  name: string;
}) {
  return (
    <fieldset className="mk-outcomes" disabled={disabled}>
      <legend>Choose your outcome</legend>
      {market.outcomes.map((label, index) => (
        <label
          key={index}
          className={cn(
            "mk-outcome",
            value === index && "mk-outcome-selected",
            market.winningOutcome === index && "mk-outcome-winner",
          )}
        >
          <input
            type="radio"
            name={name}
            value={index}
            checked={value === index}
            onChange={() => onChange(index as Outcome)}
          />
          <span className="mk-outcome-top">
            <span className="mk-outcome-name">{label}</span>
            {value === index && <Check size={15} aria-hidden="true" />}
          </span>
          <strong>
            {market.totalPool
              ? poolPercent(market.pools[index], market.totalPool).toFixed(1)
              : "0"}
            <small>%</small>
          </strong>
          <span className="mk-outcome-caption">
            {market.winningOutcome === index
              ? "Winning outcome"
              : "of current pool"}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

import { formatTokens } from "../types";
import { useHunch } from "../providers/HunchProvider";
export function StakeInput({
  id,
  value,
  onChange,
  balance,
  balancePending = false,
  error,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  balance?: bigint;
  balancePending?: boolean;
  error?: string;
  disabled: boolean;
}) {
  const { walletAddress } = useHunch();
  return (
    <div className="hunch-stake">
      <div className="hunch-stake-label">
        <label htmlFor={id}>Your stake</label>
        <span>
          {!walletAddress
            ? "Connect to see balance"
            : balancePending
              ? "Loading balance…"
              : balance === undefined
                ? "Balance unavailable"
                : `${formatTokens(balance)} TEST available`}
        </span>
      </div>
      <div className="hunch-input-wrap">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={disabled}
          placeholder="Enter whole tokens"
        />
        <span>TEST</span>
      </div>
      {error && (
        <p className="hunch-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

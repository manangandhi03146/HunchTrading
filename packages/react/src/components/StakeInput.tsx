import { formatTokens } from "../types";
export function StakeInput({
  id,
  value,
  onChange,
  balance,
  error,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  balance?: bigint;
  error?: string;
  disabled: boolean;
}) {
  return (
    <div className="hunch-stake">
      <div className="hunch-stake-label">
        <label htmlFor={id}>Your stake</label>
        <span>
          {balance === undefined
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

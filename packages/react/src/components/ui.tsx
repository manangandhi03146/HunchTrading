import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type PropsWithChildren,
} from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Layers3,
  Loader2,
  AlertCircle,
} from "lucide-react";
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { explorerUrl, type TransactionResult } from "../types";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={cn("mk-logo", small && "mk-logo-small")}>
      <span className="mk-logomark" aria-hidden="true">
        <svg
          width={small ? 18 : 22}
          height={small ? 18 : 22}
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M5 4v16M5 13c0-3 2-5 5-5s5 2 5 5v7M19 4v4"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="19" cy="13" r="2" fill="currentColor" />
        </svg>
      </span>
      hunch
      <span className="mk-logo-dot" aria-hidden="true">
        .
      </span>
    </span>
  );
}
export function Button({
  variant = "primary",
  className,
  busy,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  busy?: boolean;
}) {
  return (
    <button
      type={type}
      {...props}
      className={cn("mk-button", `mk-button-${variant}`, className)}
      disabled={props.disabled || busy}
    >
      {busy && <Loader2 size={16} className="mk-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("mk-card", className)} />;
}
export function Badge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "success" | "warning" | "violet" }>) {
  return (
    <span className={`mk-badge mk-badge-${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="mk-error" role="alert">
      <AlertCircle size={17} aria-hidden="true" />
      <div>
        {error instanceof Error ? error.message : String(error)}
        {retry && (
          <button type="button" className="mk-text-button" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <div className="mk-empty">
      <Layers3 size={28} aria-hidden="true" />
      <strong>{title}</strong>
      {children}
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="mk-skeleton" role="status" aria-label="Loading market">
      <span />
      <span />
      <div>
        <span />
        <span />
      </div>
      <span />
    </div>
  );
}
export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState("");
  useEffect(() => setStatus(""), [text]);
  useEffect(() => {
    if (status !== "Copied") return;
    const timer = setTimeout(() => setStatus(""), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <>
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus("Copied");
          } catch {
            setStatus("Copy unavailable. Select and copy the code manually.");
          }
        }}
      >
        {status === "Copied" ? <Check size={15} /> : <Copy size={15} />}{" "}
        {status === "Copied" ? "Copied" : "Copy code"}
      </Button>
      <span className="mk-copy-feedback" role="status">
        {status !== "Copied" ? status : ""}
      </span>
    </>
  );
}
export function TransactionLink({ result }: { result: TransactionResult }) {
  return result.simulated ? (
    <span className="mk-transaction-label">
      Simulated receipt · not on-chain
    </span>
  ) : (
    <a
      className="mk-text-link"
      href={explorerUrl(result.signature)}
      target="_blank"
      rel="noopener noreferrer"
    >
      View Devnet transaction <ArrowUpRight size={13} />
    </a>
  );
}

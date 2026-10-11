import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { CopyButton, useHunch } from "@hunch/react";
import { useFunds } from "./FundsProvider";
import { formatSol, requireDevnet, type TransferQuote } from "./transactions";
import "./funds.css";

const TEST_MINT = "9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs";
const explorer = (type: "address" | "tx", id: string) =>
  `https://explorer.solana.com/${type}/${encodeURIComponent(id)}?cluster=devnet`;
export function SidebarFunds() {
  const { owner, balance } = useFunds();
  return (
    <section className="sidebar-funds" aria-label="Devnet wallet funds">
      <NavLink
        to="/wallet"
        className={({ isActive }) =>
          `sidebar-funds-heading${isActive ? " active" : ""}`
        }
      >
        <Wallet size={17} />
        <span>Funds</span>
        <ArrowUpRight size={14} />
      </NavLink>
      <strong>
        {!owner
          ? "Connect your wallet"
          : balance.isError
            ? "Balance unavailable"
            : balance.data === undefined
              ? "Loading balance…"
              : `${formatSol(balance.data)} SOL`}
      </strong>
      <small>Solana Devnet</small>
      <div>
        <Link to="/wallet#receive">
          <ArrowDownLeft size={13} />
          Add
        </Link>
        <Link to="/wallet#send">
          <ArrowUpRight size={13} />
          Remove
        </Link>
      </div>
    </section>
  );
}

export function WalletFundsPage() {
  const funds = useFunds();
  const { connection } = useConnection();
  const { mode } = useHunch();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === "#receive" || hash === "#send")
      document
        .getElementById(hash.slice(1))
        ?.scrollIntoView?.({ block: "start" });
  }, [hash, funds.owner]);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<TransferQuote | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setQuote(null);
    setError("");
  }, [funds.owner]);
  const pending = funds.receipts.some((r) => r.status === "pending");
  const locked = funds.busy || pending || reviewing;
  const mint = import.meta.env.VITE_TEST_TOKEN_MINT ?? TEST_MINT;
  const tokens = useQuery({
    queryKey: ["devnet-test", connection.rpcEndpoint, funds.owner, mint],
    enabled: !!funds.owner,
    queryFn: async () => {
      await requireDevnet(connection);
      const accounts = await connection.getParsedTokenAccountsByOwner(
        new PublicKey(funds.owner!),
        { mint: new PublicKey(mint) },
        "confirmed",
      );
      return accounts.value.reduce((total, account) => {
        const token = account.account.data.parsed.info.tokenAmount;
        if (token.decimals !== 0)
          throw new Error("The configured HUNCH token must have zero decimals.");
        return total + BigInt(token.amount);
      }, 0n);
    },
    retry: false,
    refetchInterval: 15_000,
  });
  async function review(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    setError("");
    setReviewing(true);
    setQuote(null);
    try {
      setQuote(await funds.review(recipient, amount));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not review the transfer.",
      );
    } finally {
      setReviewing(false);
    }
  }
  return (
    <div className="wallet-funds-page">
      <div className="page-title">
        <div>
          <h1>Your wallet funds</h1>
          <p>Add or remove Devnet SOL using your connected wallet.</p>
        </div>
        <span className="funds-network">Devnet · Test funds only</span>
      </div>
      <p className="funds-intro">
        Funds stay in your wallet. Hunch reads its balance and asks your wallet
        to approve outgoing transfers.
      </p>
      {!funds.owner ? (
        <section className="funds-connect">
          <Wallet size={30} />
          <h2>Connect a Devnet wallet</h2>
          <p>
            Use Phantom or Solflare. Select Devnet in your wallet for this
            walkthrough.
          </p>
          <WalletMultiButton />
          <p className="muted">
            No private key or seed phrase is needed on this site.
          </p>
        </section>
      ) : (
        <>
          <section
            className="funds-account"
            aria-label="Connected Devnet wallet"
          >
            <div>
              <span>Connected wallet</span>
              <div className="funds-address">
                <code>{funds.owner}</code>
                <CopyButton text={funds.owner} />
              </div>
              <a
                href={explorer("address", funds.owner)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Devnet Explorer <ExternalLink size={13} />
              </a>
            </div>
            <button
              className="hunch-button hunch-button-secondary"
              disabled={funds.busy}
              onClick={() => {
                void funds.refresh();
                void tokens.refetch();
              }}
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </section>
          <div className="funds-balances">
            <section>
              <span>Network fee balance</span>
              <strong>
                {funds.balance.data === undefined
                  ? "—"
                  : formatSol(funds.balance.data)}{" "}
                <small>SOL</small>
              </strong>
              <p>Receive or send SOL below.</p>
            </section>
            <section>
              <span>Live prediction token</span>
              <strong>
                {tokens.data === undefined ? "—" : tokens.data.toLocaleString()}{" "}
                <small>HUNCH</small>
              </strong>
              <p>Hunch Credits (HUNCH) come from the authorized team treasury.</p>
            </section>
          </div>
          {funds.balance.error && (
            <p className="funds-error" role="alert">
              {funds.balance.error.message}{" "}
              <button
                className="funds-text-button"
                onClick={() => void funds.balance.refetch()}
              >
                Retry balance
              </button>
            </p>
          )}
          {tokens.error && (
            <p className="funds-error" role="alert">
              Could not load HUNCH: {tokens.error.message}
            </p>
          )}
          <div className="funds-actions-grid">
            <section className="funds-action" id="receive">
              <ArrowDownLeft size={22} />
              <h2>Add funds</h2>
              <p>
                Send Devnet SOL from another wallet to your connected address,
                or request free test SOL.
              </p>
              <label className="funds-field">
                Your receiving address
                <div className="funds-address">
                  <code>{funds.owner}</code>
                  <CopyButton text={funds.owner} />
                </div>
              </label>
              <button
                className="hunch-button hunch-button-primary"
                disabled={
                  locked ||
                  funds.balance.isError ||
                  funds.balance.data === undefined
                }
                onClick={() => void funds.airdrop()}
              >
                {funds.busy ? "Checking Devnet…" : "Request 0.1 Devnet SOL"}
              </button>
              <a
                className="funds-faucet"
                href="https://faucet.solana.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open official faucet <ExternalLink size={14} />
              </a>
              <p className="funds-note">
                If the RPC faucet is rate limited, copy your address into the
                official faucet. SOL and HUNCH have no cash value here.
              </p>
            </section>
            <section className="funds-action" id="send">
              <ArrowUpRight size={22} />
              <h2>Remove funds</h2>
              <p>
                Send available Devnet SOL to another wallet. Stakes held in a
                market vault cannot be withdrawn here.
              </p>
              <form onSubmit={review}>
                <label className="funds-field">
                  Recipient wallet
                  <input
                    required
                    value={recipient}
                    onChange={(e) => {
                      setRecipient(e.target.value);
                      setQuote(null);
                    }}
                    autoComplete="off"
                    placeholder="Solana wallet address"
                    disabled={funds.busy || reviewing}
                  />
                </label>
                <label className="funds-field">
                  Amount in SOL
                  <input
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setQuote(null);
                    }}
                    autoComplete="off"
                    placeholder="0.01"
                    disabled={funds.busy || reviewing}
                  />
                </label>
                {quote ? (
                  <div
                    className="funds-review"
                    aria-label="Review Devnet transfer"
                  >
                    <h3>Review your transfer</h3>
                    <dl>
                      <div>
                        <dt>Network</dt>
                        <dd>Solana Devnet</dd>
                      </div>
                      <div>
                        <dt>To</dt>
                        <dd>
                          <code>{quote.recipient}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Amount</dt>
                        <dd>{formatSol(quote.lamports)} SOL</dd>
                      </div>
                      <div>
                        <dt>Network fee</dt>
                        <dd>{formatSol(quote.fee)} SOL</dd>
                      </div>
                      <div>
                        <dt>Total</dt>
                        <dd>{formatSol(quote.lamports + quote.fee)} SOL</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="hunch-button hunch-button-primary"
                      disabled={locked}
                      onClick={async () => {
                        await funds.send(quote);
                        setQuote(null);
                      }}
                    >
                      Approve in wallet
                    </button>
                    <button
                      type="button"
                      className="funds-text-button"
                      disabled={funds.busy}
                      onClick={() => setQuote(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="hunch-button hunch-button-secondary"
                    type="submit"
                    disabled={
                      locked ||
                      funds.balance.isError ||
                      funds.balance.data === undefined
                    }
                  >
                    {reviewing ? "Quoting transfer…" : "Review transfer"}
                  </button>
                )}
              </form>
              <p className="funds-note">
                Your wallet signs the transfer after you review the destination
                and network fee.
              </p>
            </section>
          </div>
          {pending && (
            <p className="funds-pending">
              A receipt is pending. Check its status below before submitting
              another funds operation.
            </p>
          )}
          {error && (
            <p className="funds-error" role="alert">
              {error}
            </p>
          )}
          <p className="funds-feedback" role="status">
            {funds.message}
          </p>
          <section className="funds-receipts">
            <h2>Devnet receipts</h2>
            {funds.receipts.length ? (
              <ul>
                {funds.receipts.map((r) => (
                  <li key={r.signature}>
                    <div>
                      <strong>
                        {r.kind === "airdrop" ? "Airdrop" : "Outgoing transfer"}{" "}
                        · {formatSol(r.lamports)} SOL
                      </strong>
                      <span className={`funds-status funds-status-${r.status}`}>
                        {r.status}
                      </span>
                      <a
                        href={explorer("tx", r.signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <code>
                          {r.signature.slice(0, 12)}…{r.signature.slice(-8)}
                        </code>
                        <ExternalLink size={13} />
                      </a>
                      {r.kind === "send" && <small>To {r.recipient}</small>}
                    </div>
                    {r.status === "pending" && (
                      <button
                        className="hunch-button hunch-button-secondary"
                        disabled={funds.busy}
                        onClick={() => void funds.check(r)}
                      >
                        Check status
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Confirmed actions and pending signatures will appear here. A
                pending transaction will never be resent automatically.
              </p>
            )}
          </section>
        </>
      )}
      <aside className="funds-demo-note">
        <h2>Wallet funds and demo credits</h2>
        <p>
          {mode === "mock"
            ? "The main market workspace currently uses simulated credits. "
            : "Live market stakes use HUNCH tokens rather than SOL. "}
          The SypherPK livestream exhibition has its own simulated ledger.
          Adding Devnet SOL does not add exhibition credits or swap SOL for
          HUNCH.
        </p>
        <div>
          <Link to="/fortnite">
            Open livestream demo <ArrowUpRight size={14} />
          </Link>
          <Link to="/funding">
            Fund the exhibition account <ArrowUpRight size={14} />
          </Link>
        </div>
      </aside>
    </div>
  );
}

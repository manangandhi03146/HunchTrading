import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ExternalLink,
  FlaskConical,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useDemo } from "./DemoProvider";
import { FEE, LAMPORTS, payout, quoteSwap } from "./model";
import "./demos.css";
const PROGRAM = "J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP";
const MINT = "9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs";
const number = (n: number) => n.toLocaleString();
function sol(n: number) {
  return (n / LAMPORTS).toLocaleString(undefined, { maximumFractionDigits: 9 });
}
export function FundingDemo() {
  const { state, dispatch } = useDemo();
  const [input, setInput] = useState("0.01");
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState("");
  const raw = Number(input);
  const lamports = Math.round(raw * LAMPORTS);
  const valid =
    /^\d+(\.\d{1,9})?$/.test(input) &&
    Number.isFinite(raw) &&
    raw > 0 &&
    raw <= 1 &&
    Number.isSafeInteger(lamports);
  const quote = valid ? quoteSwap(state, lamports) : 0;
  const impact =
    quote > 0
      ? Math.max(
          0,
          (1 -
            quote / ((state.exchangeTokens * lamports) / state.exchangeSol)) *
            100,
        )
      : 0;
  const winnerClaim = state.claimed ? payout(state) : 0;
  function validate() {
    if (!state.connected) return "Connect your exhibition account first.";
    if (!valid || quote < 1)
      return "Enter 0.000000001–1 SOL with at most nine decimal places and a quote of at least 1 TEST.";
    if (state.sol < lamports + FEE)
      return "Insufficient demo SOL, including the modeled transaction fee.";
    return "";
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    setMessage(error);
    if (!error) setReview(true);
  }
  function swap() {
    const error = validate();
    if (error) {
      setMessage(error);
      setReview(false);
      return;
    }
    dispatch({ type: "swap", input: lamports });
    setReview(false);
    setMessage(
      `Modeled exchange complete. ${number(quote)} demo TEST received.`,
    );
  }
  return (
    <div className="exhibition funding-page">
      <div className="demo-page-heading">
        <div>
          <span className="demo-eyebrow">FUNDING & SOLANA</span>
          <h1>Follow the tokens.</h1>
          <p>
            From a funded account to a market vault and back to a winning
            wallet.
          </p>
        </div>
        <Link to="/fortnite" className="hunch-button hunch-button-secondary">
          Open Fortnite market <ArrowRight size={16} />
        </Link>
      </div>
      <div className="demo-disclosure">
        <FlaskConical size={16} />
        <span>
          <strong>Interactive model</strong> · Demo balances stay in this
          browser. Funding, swaps, fees, and receipts below are simulated. No
          funds move on Solana.
        </span>
      </div>
      <section className="funding-balance-banner">
        <div>
          <span className="demo-eyebrow">EXHIBITION ACCOUNT</span>
          <h2>
            {state.connected ? "Your demo wallet" : "Start with a demo wallet"}
          </h2>
          <p>
            {state.connected
              ? "Shared by these two exhibition pages. Separate from your connected Hunch wallet."
              : "No extension or private key needed for this walkthrough."}
          </p>
        </div>
        <div>
          <span>Network fee balance</span>
          <strong>
            {sol(state.sol)} <small>SOL</small>
          </strong>
        </div>
        <div>
          <span>Available to predict</span>
          <strong>
            {number(state.tokens)} <small>TEST</small>
          </strong>
        </div>
      </section>
      <div className="funding-layout">
        <section className="demo-panel">
          <div className="demo-section-heading">
            <h2>Fund your account</h2>
            <span>THREE STEPS</span>
          </div>
          <ol className="funding-steps">
            <li>
              <span className="funding-step-icon">
                {state.connected ? <Check size={18} /> : "1"}
              </span>
              <div>
                <h3>Connect an exhibition account</h3>
                <p>
                  A real wallet signs transactions. This account models that
                  flow without holding any keys.
                </p>
                <button
                  className="hunch-button hunch-button-secondary"
                  disabled={state.connected}
                  onClick={() => dispatch({ type: "connect" })}
                >
                  <Wallet size={15} />
                  {state.connected
                    ? "Demo account connected"
                    : "Connect demo account"}
                </button>
              </div>
            </li>
            <li>
              <span className="funding-step-icon">
                {state.faucetUsed ? <Check size={18} /> : "2"}
              </span>
              <div>
                <h3>Add SOL for network fees</h3>
                <p>
                  SOL pays the network fee. It is separate from the token you
                  stake in a Hunch market.
                </p>
                <button
                  className="hunch-button hunch-button-secondary"
                  disabled={!state.connected || state.faucetUsed}
                  onClick={() => dispatch({ type: "faucet" })}
                >
                  {state.faucetUsed
                    ? "0.25 demo SOL added"
                    : "Request 0.25 demo SOL"}
                </button>
              </div>
            </li>
            <li>
              <span className="funding-step-icon">
                {state.grantUsed ? <Check size={18} /> : "3"}
              </span>
              <div>
                <h3>Receive the market’s TEST token</h3>
                <p>
                  The token mint identifies which asset the vault accepts. Our
                  real Devnet TEST treasury requires an authorized operator.
                </p>
                <button
                  className="hunch-button hunch-button-primary"
                  disabled={
                    !state.connected || state.grantUsed || state.sol < FEE
                  }
                  onClick={() => dispatch({ type: "grant" })}
                >
                  {state.grantUsed
                    ? "1,000 demo TEST received"
                    : "Receive 1,000 demo TEST"}
                </button>
              </div>
            </li>
          </ol>
          <p className="demo-caption">
            The demo grant is available once per exhibition reset. Account rent
            and priority fees are omitted; this is not an all-in transaction
            quote.
          </p>
          <Link to="/fortnite" className="panel-link">
            Use your balance in the Fortnite market <ArrowRight size={14} />
          </Link>
        </section>
        <section className="demo-panel exchange-panel">
          <div className="demo-section-heading">
            <h2>Solana exchange model</h2>
            <span>SIMULATED AMM</span>
          </div>
          <p>
            See how a SOL → TEST swap changes balances. This illustrative
            exchange is separate from Hunch’s prediction contract.
          </p>
          <form onSubmit={submit}>
            <label className="swap-field">
              <span>
                You send <strong>SOL</strong>
              </span>
              <input
                type="text"
                inputMode="decimal"
                aria-label="SOL to exchange"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setReview(false);
                }}
              />
              <small>Available: {sol(state.sol)} SOL</small>
            </label>
            <div className="swap-arrow">
              <ArrowDown size={18} />
            </div>
            <div className="swap-field swap-output">
              <span>
                You receive <strong>TEST</strong>
              </span>
              <strong>{number(quote)}</strong>
              <small>Whole demo tokens, rounded down</small>
            </div>
            <dl className="swap-quote">
              <div>
                <dt>Model</dt>
                <dd>Constant product · x × y = k</dd>
              </div>
              <div>
                <dt>Price impact + integer rounding</dt>
                <dd>{impact.toFixed(2)}%</dd>
              </div>
              <div>
                <dt>Modeled network fee</dt>
                <dd>0.000005 SOL</dd>
              </div>
              <div>
                <dt>Swap fee</dt>
                <dd>0% in this exhibition</dd>
              </div>
            </dl>
            {review ? (
              <div className="stake-review">
                <p>
                  Exchange {sol(lamports)} demo SOL for {number(quote)} demo
                  TEST, plus 0.000005 demo SOL for the modeled fee.
                </p>
                <button
                  className="hunch-button hunch-button-primary"
                  type="button"
                  onClick={swap}
                >
                  Confirm modeled swap
                </button>
                <button
                  className="demo-text-button"
                  type="button"
                  onClick={() => setReview(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="hunch-button hunch-button-primary ticket-submit"
                type="submit"
              >
                Review modeled swap <ArrowRight size={15} />
              </button>
            )}
            <p className="demo-feedback" role="status">
              {message}
            </p>
          </form>
          <p className="demo-caption">
            No deployed TEST/SOL exchange or redeemability is implied. TEST has
            no cash value. Other market participants cannot trade against this
            model.
          </p>
        </section>
      </div>
      <section className="demo-panel ledger-section">
        <div className="demo-section-heading">
          <h2>Where the tokens go</h2>
          <span>MARKET ACCOUNTING</span>
        </div>
        <div className="ledger-flow">
          <div>
            <span className="ledger-icon">
              <Wallet size={23} />
            </span>
            <h3>Your account</h3>
            <strong>{number(state.tokens)} TEST</strong>
            <p>Available balance after funding, stakes, swaps, and claims.</p>
          </div>
          <ArrowRight size={22} className="ledger-arrow" />
          <div>
            <span className="ledger-icon">
              <ShieldCheck size={23} />
            </span>
            <h3>Market vault</h3>
            <strong>
              {number(state.pool[0] + state.pool[1] - winnerClaim)} TEST
            </strong>
            <p>
              Includes seeded simulated crowd stakes. Your locked stake:{" "}
              {number(state.position[0] + state.position[1])} TEST.
            </p>
          </div>
          <ArrowRight size={22} className="ledger-arrow" />
          <div>
            <span className="ledger-icon">
              <Check size={23} />
            </span>
            <h3>Winner claim</h3>
            <strong>
              {state.placement === null
                ? "Awaiting result"
                : `${number(payout(state))} TEST`}
            </strong>
            <p>
              {state.claimed
                ? "Claimed into your available balance."
                : "Calculated from your winning share of the final pool."}
            </p>
          </div>
        </div>
        <p className="demo-caption">
          In the real program, a PDA authorizes vault transfers. Staking updates
          the vault and position together; each winning position can claim once.
          The vault model here shows only your claim, not simulated crowd
          claims.
        </p>
      </section>
      <section className="demo-panel receipts-section">
        <div className="demo-section-heading">
          <h2>Exhibition receipts</h2>
          <span>NO BLOCKCHAIN SIGNATURES</span>
        </div>
        {state.receipts.length ? (
          <div className="demo-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">TEST change</th>
                  <th scope="col">SOL change</th>
                  <th scope="col">Demo receipt</th>
                </tr>
              </thead>
              <tbody>
                {state.receipts.map((r) => (
                  <tr key={r.id}>
                    <td>{r.action}</td>
                    <td className={r.tokens > 0 ? "positive-value" : ""}>
                      {r.tokens > 0 ? "+" : ""}
                      {number(r.tokens)}
                    </td>
                    <td>
                      {r.lamports > 0 ? "+" : ""}
                      {sol(r.lamports)}
                    </td>
                    <td>
                      <code>{r.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="crowd-empty">
            Connect and fund your demo account to create your first receipt.
          </p>
        )}
      </section>
      <section className="demo-panel real-devnet">
        <div>
          <span className="demo-eyebrow">REAL DEVNET RESOURCES</span>
          <h2>Inspect the deployed accounts.</h2>
          <p>
            These links show actual public addresses. They are separate from the
            exhibition receipts above. A full funded Devnet lifecycle remains
            pending team signer access.
          </p>
        </div>
        <div className="devnet-links">
          <a
            href={`https://explorer.solana.com/address/${PROGRAM}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Hunch program <ExternalLink size={14} />
            <code>{PROGRAM}</code>
          </a>
          <a
            href={`https://explorer.solana.com/address/${MINT}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
          >
            TEST mint <ExternalLink size={14} />
            <code>{MINT}</code>
          </a>
          <a
            href="https://faucet.solana.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Official Devnet SOL faucet <ExternalLink size={14} />
          </a>
          <a
            href="https://solana.com/docs/core/fees"
            target="_blank"
            rel="noopener noreferrer"
          >
            Understand Solana fees <ExternalLink size={14} />
          </a>
        </div>
      </section>
    </div>
  );
}

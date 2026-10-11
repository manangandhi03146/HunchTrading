import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useDemo } from "./DemoProvider";
import { CUES, cueAt, payout, share, type Side } from "./model";
import { TwitchVod, VOD } from "./TwitchVod";
import "./demos.css";
const number = (n: number) => n.toLocaleString();
function Clock({ second }: { second: number }) {
  return (
    <>
      {Math.floor(second / 60)}:
      {String(Math.floor(second % 60)).padStart(2, "0")}
    </>
  );
}
export function FortniteDemo() {
  const { state, dispatch } = useDemo();
  const [playing, setPlaying] = useState(false);
  const [second, setSecond] = useState(0);
  const [clock, setClock] = useState<"presentation" | "vod">("vod");
  const [ready, setReady] = useState(false);
  const [seekTo, setSeekTo] = useState<number | null>(VOD.start);
  const [side, setSide] = useState<Side>(0);
  const [amount, setAmount] = useState("100");
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState("");
  const [placement, setPlacement] = useState("9");
  const [resetConfirm, setResetConfirm] = useState(false);
  const wasClaimed = useRef(state.claimed);
  const cue = cueAt(second);
  const yes = share(state.pool);
  const total = state.pool[0] + state.pool[1];
  const change = yes - (state.history.at(-2)?.share ?? yes);
  const stake = Number(amount);
  const estimated =
    Number.isSafeInteger(stake) && stake > 0
      ? Math.floor(
          ((state.position[side] + stake) * (total + stake)) /
            (state.pool[side] + stake),
        )
      : 0;
  const winning =
    state.placement === null ? null : state.placement < 10 ? 0 : 1;
  const eligible = payout(state);
  useLayoutEffect(() => {
    dispatch({ type: "restartMarket" });
  }, [dispatch]);
  useEffect(() => {
    if (!playing || clock !== "presentation" || state.placement !== null)
      return;
    const interval = setInterval(
      () => setSecond((t) => Math.min(t + 1, 220)),
      1000,
    );
    return () => clearInterval(interval);
  }, [playing, clock, state.placement]);
  useEffect(() => {
    if (!playing || state.placement !== null) return;
    const tick = Math.floor(second / 4);
    if (tick > state.tick) dispatch({ type: "tick", tick, second });
    if (second >= 220) {
      dispatch({ type: "resolve", placement: 9 });
      setPlaying(false);
      setReview(false);
    }
  }, [second, playing, state.tick, state.placement, dispatch]);
  useEffect(() => {
    if (state.claimed && !wasClaimed.current)
      setMessage(
        `Claim complete. ${number(eligible)} demo HUNCH returned to your exhibition balance.`,
      );
    wasClaimed.current = state.claimed;
  }, [state.claimed, eligible]);
  function validate() {
    if (!state.connected || state.tokens === 0)
      return "Fund your exhibition account on the funding page first.";
    if (state.placement !== null || second >= 220)
      return "This exhibition market has closed.";
    if (!Number.isSafeInteger(stake) || stake < 1)
      return "Enter a positive whole number of HUNCH tokens.";
    if (stake > state.tokens)
      return "Your exhibition balance is too low for this stake.";
    if (state.sol < 5_000)
      return "You need demo SOL to model the transaction fee.";
    return "";
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const error = validate();
    setMessage(error);
    if (!error) setReview(true);
  }
  function confirmStake() {
    const error = validate();
    if (error) {
      setMessage(error);
      setReview(false);
      return;
    }
    dispatch({ type: "stake", side, amount: stake });
    setReview(false);
    setMessage(
      `${number(stake)} demo HUNCH staked on ${side === 0 ? "Yes" : "No"}.`,
    );
  }
  function jump() {
    const next = CUES.find((c) => c.second > second);
    if (next) {
      setSecond(next.second);
      if (clock === "vod") setSeekTo(VOD.start + next.second);
      setPlaying(true);
    }
  }
  function reset() {
    dispatch({ type: "reset" });
    setSecond(0);
    setPlaying(false);
    setSeekTo(VOD.start);
    setReview(false);
    setMessage(
      "Exhibition reset. Fund a new demo account to participate again.",
    );
    setResetConfirm(false);
  }
  const chart = (side: Side) => state.history.map((p) =>
    `${20 + (Math.min(p.tick * 4, 220) / 220) * 580},${132 - (side === 0 ? p.share : 100 - p.share) * 1.04}`,
  ).join(" ");
  const chartX = 20 + (Math.min(state.tick * 4, 220) / 220) * 580;
  return (
    <div className="exhibition">
      <div className="demo-page-heading">
        <div>
          <span className="demo-eyebrow">LIVESTREAM DEMO</span>
          <h1>A hunch, in the middle of the action.</h1>
          <p>Watch SypherPK play Fortnite. Back a finish. Follow the crowd.</p>
        </div>
        <Link to="/funding" className="hunch-button hunch-button-secondary">
          <Wallet size={16} /> Fund demo account
        </Link>
      </div>
      <div className="demo-disclosure">
        <Radio size={16} />
        <span>
          <strong>Exhibition</strong> · Recorded gameplay, scripted match cues, simulated
          participants and tokens. This page does not submit Solana
          transactions.
        </span>
      </div>
      <div className="vod-market-layout">
        <div className="vod-column">
          <section className="demo-panel video-panel">
            <div className="streamer-heading">
              <div className="streamer-avatar">S</div>
              <div>
                <a
                  href="https://www.twitch.tv/sypherpk"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  SypherPK{" "}
                  <ShieldCheck size={16} aria-label="Twitch Verified Partner" />
                </a>
                <p>Fortnite · Twitch Verified Partner</p>
              </div>
              <span className="demo-replay-label">DEMO BROADCAST</span>
            </div>
            <TwitchVod
              playing={playing}
              seekTo={seekTo}
              onReady={setReady}
              onTime={(time, paused) => {
                if (clock !== "vod" || !ready || state.placement !== null || !Number.isFinite(time)) return;
                setPlaying(!paused);
                if (!paused) setSecond(Math.max(0, Math.min(220, time - VOD.start)));
              }}
            />
            <div className="broadcast-quotes" aria-label="Changing demo outcome quotes">
              {([0, 1] as Side[]).map((outcome) => {
                const value = outcome === 0 ? yes : 100 - yes;
                const delta = outcome === 0 ? change : -change;
                return <div key={outcome} className={outcome === 0 ? "quote-yes" : "quote-no"}>
                  <span>{outcome === 0 ? "Yes" : "No"} · indicative quote</span>
                  <strong>{(value / 100).toFixed(4)} <small>HUNCH</small></strong>
                  <span>{delta >= 0 ? "+" : ""}{(delta / 100).toFixed(4)} since last update</span>
                </div>;
              })}
              <p>Updates every 4 seconds of playback from modeled crowd stakes. Quotes represent pool share; this staking prototype does not execute share-price orders.</p>
            </div>
            <div className="vod-controls">
              <button
                className="hunch-button hunch-button-primary"
                disabled={state.placement !== null}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
                {playing ? "Pause exhibition" : "Start exhibition"}
              </button>
              <button
                className="hunch-button hunch-button-secondary"
                onClick={jump}
                disabled={second >= 220 || state.placement !== null}
              >
                Next modeled event <ChevronRight size={15} />
              </button>
            </div>
            <div className="vod-clock">
              <label>
                Scenario clock{" "}
                <select
                  value={clock}
                  onChange={(e) => {
                    setClock(e.target.value as typeof clock);
                    setPlaying(false);
                  }}
                >
                  <option value="presentation">Presentation clock</option>
                  <option value="vod">Sync to broadcast playback</option>
                </select>
              </label>
              <span>
                <Clock second={second} /> / 3:40
              </span>
            </div>
            <p className="demo-caption">
              Scripted cues illustrate a match and are not detected from this
              gameplay. Broadcast sync follows the player timestamp; the presentation
              clock works through ads or playback interruptions.
            </p>
          </section>
          <section className="demo-panel cue-panel">
            <div className="demo-section-heading">
              <h2>Match cues</h2>
              <span>MODELED SCENARIO</span>
            </div>
            <div className="current-cue">
              <span className="cue-icon">
                <Radio size={20} />
              </span>
              <div>
                <strong>{cue.label}</strong>
                <p>{cue.detail}</p>
              </div>
            </div>
            <div className="cue-timeline">
              {CUES.map((c) => (
                <button
                  key={c.second}
                  disabled={state.placement !== null}
                  className={c.second <= second ? "cue-passed" : ""}
                  onClick={() => {
                    setSecond(c.second);
                    if (clock === "vod") setSeekTo(VOD.start + c.second);
                    setPlaying(true);
                  }}
                >
                  <span>
                    {c.second <= second ? (
                      <Check size={12} />
                    ) : (
                      <span className="cue-empty" />
                    )}
                  </span>
                  <small>
                    <Clock second={c.second} />
                  </small>
                  <strong>{c.label}</strong>
                </button>
              ))}
            </div>
            <details className="demo-details">
              <summary>Report an observed gameplay event</summary>
              <p>
                Presenter annotations move the simulated crowd. They do not
                verify the footage or authorize on-chain settlement.
              </p>
              <div className="demo-button-row">
                <button
                  onClick={() =>
                    dispatch({
                      type: "cue",
                      cue: "Presenter: elimination observed",
                      bias: 95,
                    })
                  }
                  disabled={state.placement !== null}
                >
                  Elimination · Yes reaction
                </button>
                <button
                  onClick={() =>
                    dispatch({
                      type: "cue",
                      cue: "Presenter: storm pressure observed",
                      bias: 5,
                    })
                  }
                  disabled={state.placement !== null}
                >
                  Storm pressure · No reaction
                </button>
              </div>
              <label>
                Modeled final placement{" "}
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={placement}
                  onChange={(e) => setPlacement(e.target.value)}
                />
              </label>
              <button
                className="hunch-button hunch-button-secondary"
                disabled={
                  state.placement !== null ||
                  !Number.isInteger(Number(placement)) ||
                  Number(placement) < 1 ||
                  Number(placement) > 100
                }
                onClick={() => {
                  dispatch({ type: "resolve", placement: Number(placement) });
                  setPlaying(false);
                  setReview(false);
                }}
              >
                Close and model result
              </button>
            </details>
          </section>
          <section className="demo-panel">
            <div className="demo-section-heading">
              <h2>Odds over match time</h2>
              <span>YES / NO POOL SHARE</span>
            </div>
            <div className="share-chart">
              <svg
                viewBox="0 0 640 180"
                role="img"
                aria-label={`Match odds graph: Yes ${yes.toFixed(1)} percent, No ${(100 - yes).toFixed(1)} percent`}
              >
                <line x1="20" x2="600" y1="28" y2="28" className="chart-grid" />
                <line x1="20" x2="600" y1="80" y2="80" className="chart-grid" />
                <line
                  x1="20"
                  x2="600"
                  y1="132"
                  y2="132"
                  className="chart-grid"
                />
                <polyline points={chart(0)} className="chart-line" data-outcome="yes" />
                <polyline points={chart(1)} className="chart-line chart-line-no" data-outcome="no" />
                <circle cx={chartX} cy={132 - yes * 1.04} r="4" className="chart-current-yes" />
                <circle cx={chartX} cy={132 - (100 - yes) * 1.04} r="4" className="chart-current-no" />
                <text x="20" y="164">0:00</text>
                <text x="292" y="164">1:50</text>
                <text x="572" y="164">3:40</text>
                <text x="607" y="33">
                  100%
                </text>
                <text x="607" y="85">
                  50%
                </text>
                <text x="607" y="137">
                  0%
                </text>
              </svg>
            </div>
            <div className="odds-legend"><span>Yes {yes.toFixed(1)}%</span><span>No {(100 - yes).toFixed(1)}%</span></div>
            <p className="demo-caption">
              Pool share changes when participants stake. It is not a fixed
              price or calibrated probability. Positions cannot be resold in
              this prototype.
            </p>
          </section>
        </div>
        <aside className="ticket-column">
          <section className="demo-panel trade-ticket">
            <div className="demo-section-heading">
              <span
                className={`market-open-label ${state.placement !== null ? "is-settled" : ""}`}
              >
                <i />
                {state.placement !== null
                  ? "Resolved · exhibition"
                  : "Open · exhibition"}
              </span>
              <span>YES / NO</span>
            </div>
            <h2>Will SypherPK finish higher than 10th?</h2>
            <p className="market-rule">
              Yes = 1st–9th. No = 10th or lower. The scripted exhibition
              finishes 9th.
            </p>
            <div className="demo-pool-options">
              {([0, 1] as Side[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={side === s}
                  className={`pool-option ${s === 0 ? "yes-option" : "no-option"} ${side === s ? "selected" : ""}`}
                  disabled={state.placement !== null}
                  onClick={() => {
                    setSide(s);
                    setReview(false);
                  }}
                >
                  <span>{s === 0 ? "Yes" : "No"}</span>
                  <strong>
                    {(s === 0 ? yes : 100 - yes).toFixed(1)}
                    <small>%</small>
                  </strong>
                  <span>{number(state.pool[s])} HUNCH</span>
                </button>
              ))}
            </div>
            <div
              className="demo-pool-bar"
              aria-label="Outcome pool proportions"
            >
              <span style={{ width: `${yes}%` }} />
            </div>
            <div className="ticket-meta">
              <span>Total pool</span>
              <strong>{number(total)} HUNCH</strong>
            </div>
            <div className="ticket-meta">
              <span>Your available balance</span>
              <strong>{number(state.tokens)} HUNCH</strong>
            </div>
            {state.placement === null ? (
              <form onSubmit={submit}>
                <label className="stake-label">
                  Your stake <span>Whole demo HUNCH tokens</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setReview(false);
                    }}
                    required
                  />
                </label>
                <div className="stake-shortcuts">
                  {[50, 100, 250].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setAmount(String(n));
                        setReview(false);
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="payout-estimate">
                  <span>
                    Estimated total return if {side === 0 ? "Yes" : "No"} wins
                  </span>
                  <strong>{number(estimated)} HUNCH</strong>
                  <small>
                    Includes your existing stake on this outcome. Changes with
                    the final pool.
                  </small>
                </div>
                {review ? (
                  <div className="stake-review">
                    <p>
                      Confirm {number(stake)} demo HUNCH on{" "}
                      <strong>{side === 0 ? "Yes" : "No"}</strong>. A modeled
                      0.000005 SOL fee applies. Stakes stay locked until
                      settlement.
                    </p>
                    <button
                      type="button"
                      className="hunch-button hunch-button-primary"
                      onClick={confirmStake}
                    >
                      Confirm demo prediction
                    </button>
                    <button
                      type="button"
                      className="demo-text-button"
                      onClick={() => setReview(false)}
                    >
                      Back
                    </button>
                  </div>
                ) : state.connected && state.tokens > 0 ? (
                  <button
                    className="hunch-button hunch-button-primary ticket-submit"
                    type="submit"
                  >
                    Review prediction <ArrowRight size={16} />
                  </button>
                ) : (
                  <Link
                    to="/funding"
                    className="hunch-button hunch-button-primary ticket-submit"
                  >
                    Fund an exhibition account <ArrowRight size={16} />
                  </Link>
                )}
              </form>
            ) : (
              <div className="settlement-box">
                <CheckCircle2 size={24} />
                <h3>Modeled result: {winning === 0 ? "Yes" : "No"}</h3>
                <p>
                  Final placement #{state.placement}.{" "}
                  {state.claimed
                    ? "Your payout has been claimed."
                    : eligible > 0
                      ? `${number(eligible)} demo HUNCH available to claim.`
                      : "No winning position in this account."}
                </p>
                {eligible > 0 && (
                  <button
                    className="hunch-button hunch-button-primary"
                    disabled={state.claimed || state.sol < 5_000}
                    onClick={() => dispatch({ type: "claim" })}
                  >
                    {state.claimed ? "Claimed" : "Claim demo winnings"}
                  </button>
                )}
                <Link to="/funding">
                  Inspect balance and receipts <ArrowRight size={14} />
                </Link>
              </div>
            )}
            <p className="demo-feedback" role="status">
              {message}
            </p>
            <div className="your-demo-position">
              <span>Your positions</span>
              <strong>
                Yes {number(state.position[0])} · No {number(state.position[1])}{" "}
                HUNCH
              </strong>
            </div>
          </section>
          <section className="demo-panel crowd-panel">
            <div className="demo-section-heading">
              <h2>Market activity</h2>
              <span>SIMULATED VIEWERS</span>
            </div>
            {state.activity.length ? (
              <ul>
                {state.activity.slice(0, 9).map((a) => (
                  <li key={a.id}>
                    <span className="activity-avatar">
                      {a.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>{a.name}</strong>
                      <small>{a.cue}</small>
                    </div>
                    <span
                      className={a.side === 0 ? "activity-yes" : "activity-no"}
                    >
                      {a.side === 0 ? "Yes" : "No"}
                      <strong>{a.amount} HUNCH</strong>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="crowd-empty">
                <Radio size={22} />
                <p>Start the exhibition to watch the modeled crowd react.</p>
              </div>
            )}
          </section>
          <section className="demo-panel solana-explainer">
            <span className="demo-eyebrow">THE SOLANA CONNECTION</span>
            <h3>One stake. Two changes.</h3>
            <p>
              In the live program, a stake transfers tokens into the vault and
              updates your position atomically. The resolver records a winner;
              the program calculates claims.
            </p>
            <Link to="/funding">
              Explore funding & settlement <ArrowRight size={14} />
            </Link>
          </section>
        </aside>
      </div>
      <div className="demo-bottom-note">
        <span>
          Twitch partner status identifies the source channel. Hunch has no
          affiliation with SypherPK, Twitch, or Epic Games.
        </span>
        {resetConfirm ? (
          <span>
            Reset balances and positions?{" "}
            <button className="demo-text-button" onClick={reset}>
              Reset exhibition
            </button>{" "}
            <button
              className="demo-text-button"
              onClick={() => setResetConfirm(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="demo-text-button"
            onClick={() => setResetConfirm(true)}
          >
            <RotateCcw size={14} /> Reset exhibition
          </button>
        )}
      </div>
    </div>
  );
}

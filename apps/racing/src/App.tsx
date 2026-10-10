import { appUrl } from "../../shared/links";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Flag,
  Radio,
  RotateCcw,
  Play,
  CheckCircle2,
  Clock3,
  ShieldCheck,
  ChevronRight,
  Zap,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  MockMarketKitClient,
  PredictionMarket,
  effectiveStatus,
  useMarket,
  useMarketKit,
} from "@marketkit/react";
import { AppHeader } from "../../shared/AppHeader";

function Car({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 80 38" role="img" aria-label="Race car">
      <rect x="15" y="3" width="15" height="7" rx="2" fill="#080b0a" />
      <rect x="15" y="28" width="15" height="7" rx="2" fill="#080b0a" />
      <rect x="52" y="3" width="15" height="7" rx="2" fill="#080b0a" />
      <rect x="52" y="28" width="15" height="7" rx="2" fill="#080b0a" />
      <path d="M8 13h16l8-6h20l11 7 10 1v9l-12 2-9 5H30l-9-6H8z" fill={color} />
      <path d="M33 11h16l9 7-9 7H32l6-7z" fill="#1d2527" />
      <path d="M11 13v12M68 14v11" stroke="#ffffff77" strokeWidth="2" />
    </svg>
  );
}
export default function App() {
  const { client, mode, notify } = useMarketKit();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const marketId =
    params.get("market") ??
    import.meta.env.VITE_MARKETKIT_MARKET_ID ??
    "race-42";
  const market = useMarket(marketId);
  const race = useQuery({
    queryKey: ["race", marketId, mode],
    queryFn: () => client.getRace(marketId),
    refetchInterval: (query) =>
      query.state.data?.status === "racing" ? 700 : 2000,
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);
  const start = useMutation({
    mutationFn: () => client.startRace(marketId),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      notify(
        mode === "mock"
          ? "Simulated race started. Settlement follows the fixture."
          : "Race started by the game server.",
      );
    },
  });
  const reset = useMutation({
    mutationFn: () => client.newDemoRace(),
    onSuccess: (next) => {
      setParams({ market: next.id });
      void queryClient.invalidateQueries();
    },
  });
  const close = useMutation({
    mutationFn: () => {
      if (!(client instanceof MockMarketKitClient))
        throw new Error("Only simulated markets support early close.");
      return client.closeDemoMarket(marketId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
  const marketStatus = market.data ? effectiveStatus(market.data, now) : null;
  const state = race.data?.status ?? "upcoming";
  const elapsed = race.data?.startedAt
    ? Math.max(0, now - race.data.startedAt)
    : 0;
  const animationOffset = useMemo(
    () =>
      state === "racing" && race.data?.startedAt
        ? -Math.max(0, Date.now() - race.data.startedAt)
        : 0,
    [state, race.data?.startedAt],
  );
  const progress =
    state === "finished"
      ? 100
      : state === "racing"
        ? Math.min(99, (elapsed / (race.data?.durationMs ?? 12000)) * 100)
        : 0;
  const secondsLeft = market.data
    ? Math.max(0, Math.ceil((market.data.closesAt * 1000 - now) / 1000))
    : 0;
  const winner =
    race.data?.winner ??
    (market.data?.status === "resolved" ? market.data.winningOutcome : null);
  const raceSteps = [
    {
      label: "Predictions close",
      detail:
        marketStatus === null
          ? "Loading market"
          : marketStatus === "open"
            ? `${secondsLeft}s remaining`
            : "Pool locked",
      complete: marketStatus !== null && marketStatus !== "open",
    },
    {
      label: "Game-server result",
      detail:
        state === "finished"
          ? mode === "mock"
            ? "Fixture received"
            : "Result received"
          : state === "racing"
            ? "Race in progress"
            : "Waiting for race",
      complete: state === "finished",
    },
    {
      label: "Market settlement",
      detail:
        market.data?.status === "resolved"
          ? mode === "mock"
            ? "Simulated resolution"
            : "Resolved on Devnet"
          : "Awaiting event",
      complete: market.data?.status === "resolved",
    },
  ];
  return (
    <div className="racing-app">
      <AppHeader
        active="racing"
        brand={
          <a className="velocity-brand" href="/">
            <Zap size={22} fill="currentColor" />
            VELOCITY<span>RACING LEAGUE</span>
          </a>
        }
      />
      <main id="main" className="racing-main">
        <div className="racing-heading">
          <div>
            <div className="eyebrow">
              <Flag size={14} />
              VELOCITY CIRCUIT · EXHIBITION RACE
            </div>
            <h1>
              The finish line
              <br />
              <span>is just the beginning.</span>
            </h1>
            <p>A live race. A shared prediction pool. One seamless finish.</p>
          </div>
          <div className="racing-round">
            <span>EXHIBITION</span>
            <strong>
              01<span>/03</span>
            </strong>
            <div>
              <Radio size={12} />{" "}
              {state === "racing"
                ? "RACE IN PROGRESS"
                : state === "finished"
                  ? "RACE COMPLETE"
                  : "PADDOCK OPEN"}
            </div>
          </div>
        </div>
        <div className="racing-layout">
          <div className="racing-left">
            <div className="mode-notice">
              <span>
                {mode === "mock"
                  ? "Interactive simulation · TEST credits have no value. Race results and settlement are fixtures."
                  : "Solana Devnet · game-server results are authoritative. TEST tokens have no value."}
              </span>
              <span>POWERED BY HUNCH</span>
            </div>
            <section className="race-stage" aria-label="Racing circuit">
              <div className="race-stage-head">
                <div>
                  <span className="kicker">LIVE CIRCUIT</span>
                  <h2>Terminal Sprint</h2>
                </div>
                <Badge tone={state === "racing" ? "success" : "neutral"}>
                  {state === "racing"
                    ? "Live"
                    : state === "finished"
                      ? "Finished"
                      : "Upcoming"}
                </Badge>
              </div>
              <div className="circuit-info">
                <span>2 racers</span>
                <span>12-second sprint</span>
                <span>Winner takes the flag</span>
              </div>
              <div className="race-lanes">
                {([0, 1] as const).map((index) => (
                  <div className="race-lane" key={`${marketId}:${index}`}>
                    <div className="racer-label">
                      <span className={`racer-number racer-${index}`}>
                        0{index + 1}
                      </span>
                      <div>
                        <strong>
                          {market.data?.outcomes[index] ??
                            `Player ${index === 0 ? "A" : "B"}`}
                        </strong>
                        <span>
                          {index === 0 ? "APEX MOTORSPORT" : "NIGHTFALL RACING"}
                        </span>
                      </div>
                      <span className="racer-progress tabular">
                        {state === "finished"
                          ? winner === index
                            ? "P1"
                            : "P2"
                          : `${Math.round(progress)}%`}
                      </span>
                    </div>
                    <div className="lane-runway">
                      <div className="lane-center" />
                      <span className="start-marker">START</span>
                      <span
                        className="finish-marker"
                        aria-label="Finish line"
                      />
                      <div
                        className={`race-runner runner-${index} ${state === "racing" ? "is-racing" : ""} ${state === "finished" ? "has-finished" : ""} ${winner === index ? "is-winner" : ""}`}
                        style={{
                          animationDuration: `${race.data?.durationMs ?? 12000}ms`,
                          animationDelay:
                            state === "racing"
                              ? `${animationOffset}ms`
                              : undefined,
                        }}
                      >
                        <Car color={index === 0 ? "#b9f56b" : "#8fa3c4"} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="race-stage-bottom">
                <span>
                  <Clock3 size={14} />
                  {state === "racing"
                    ? `${Math.max(0, ((race.data?.durationMs ?? 12000) - elapsed) / 1000).toFixed(1)}s to finish`
                    : state === "finished"
                      ? "Official result received"
                      : marketStatus === null
                        ? "Loading market"
                        : marketStatus === "open"
                          ? `Predictions close in ${secondsLeft}s`
                          : "Predictions closed · ready to race"}
                </span>
                <span>Progress animation is illustrative</span>
              </div>
              {winner !== null && (
                <div className="race-winner" role="status">
                  <Flag size={20} />
                  <span>
                    {market.data?.outcomes[winner] ??
                      `Player ${winner === 0 ? "A" : "B"}`}{" "}
                    takes the checkered flag.
                  </span>
                  <Badge tone="success">
                    {mode === "mock" ? "Fixture result" : "Server result"}
                  </Badge>
                </div>
              )}
            </section>
            <Card className="race-controls">
              <div>
                <span className="kicker">DEMO CONTROLS</span>
                <h3>From prediction to podium.</h3>
                <p>
                  Start the race after the pool closes. The authorized result
                  drives settlement.
                </p>
              </div>
              <div className="race-control-buttons">
                <Button
                  disabled={
                    marketStatus !== "closed" ||
                    state === "racing" ||
                    state === "finished" ||
                    market.isError ||
                    race.isPending ||
                    race.isError
                  }
                  busy={start.isPending}
                  onClick={() => start.mutate()}
                >
                  <Play size={14} />
                  Start race
                </Button>
                {mode === "mock" && (
                  <Button
                    variant="secondary"
                    disabled={marketStatus !== "open" || state !== "upcoming"}
                    busy={close.isPending}
                    onClick={() => close.mutate()}
                  >
                    Close demo predictions
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={mode !== "mock" || state === "racing"}
                  busy={reset.isPending}
                  onClick={() => reset.mutate()}
                >
                  <RotateCcw size={13} />
                  New demo race
                </Button>
              </div>
              {mode === "sdk" && (
                <p>
                  For another live run, select a new market with{" "}
                  <code>?market=ID</code>.
                </p>
              )}
              {(start.error || close.error || reset.error) && (
                <ErrorState error={start.error ?? close.error ?? reset.error} />
              )}
              {race.error && (
                <ErrorState
                  error={race.error}
                  retry={() => {
                    void race.refetch();
                  }}
                />
              )}
              {market.error && (
                <ErrorState
                  error={market.error}
                  retry={() => {
                    void market.refetch();
                  }}
                />
              )}
            </Card>
            <div className="race-lifecycle">
              {raceSteps.map((step, index) => (
                <div key={step.label}>
                  <span className={step.complete ? "step-done" : ""}>
                    {step.complete ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      `0${index + 1}`
                    )}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </div>
                  {index < 2 && (
                    <ChevronRight size={14} className="step-chevron" />
                  )}
                </div>
              ))}
            </div>
          </div>
          <aside>
            <div className="widget-caption">
              <span>MAKE YOUR CALL</span>
              <ShieldCheck size={14} />
            </div>
            <PredictionMarket key={marketId} marketId={marketId} />
            <div className="embed-note">
              <span>One component. Any application.</span>
              <code>{'<PredictionMarket marketId="…" />'}</code>
              <a href={appUrl("dashboard", "/integration")}>
                Explore the integration <ArrowRight size={12} />
              </a>
            </div>
          </aside>
        </div>
        <footer className="app-footer">
          <span>Velocity Racing · A hunch integration demo</span>
          <span>
            Solana Devnet infrastructure · nonredeemable test tokens only
          </span>
        </footer>
      </main>
    </div>
  );
}

import { appUrl } from "../../shared/links";
import { useState } from "react";
import {
  Crosshair,
  Trophy,
  CalendarDays,
  ArrowUpRight,
  ChevronRight,
  Radio,
  Swords,
  Triangle,
  Hexagon,
  Orbit,
  AudioLines,
} from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  MarketStatus,
  PredictionMarket,
  formatTokens,
  useMarketKit,
  useMarkets,
} from "@marketkit/react";
import { AppHeader } from "../../shared/AppHeader";
const MATCHES = ["nova-titan", "orbit-echo", "zenith-pulse"];
const ICONS = [Triangle, Hexagon, Orbit, AudioLines];
function TeamMark({
  index,
  large = false,
}: {
  index: number;
  large?: boolean;
}) {
  const Icon = ICONS[index % ICONS.length];
  return (
    <span
      className={`team-mark team-mark-${index % 2} ${large ? "team-mark-large" : ""}`}
    >
      <Icon size={large ? 44 : 19} strokeWidth={1.5} />
    </span>
  );
}
export default function App() {
  const { mode } = useMarketKit();
  const markets = useMarkets();
  const [selected, setSelected] = useState(
    import.meta.env.VITE_MARKETKIT_MARKET_ID ?? "nova-titan",
  );
  const matches =
    mode === "mock"
      ? markets.data?.filter((market) => MATCHES.includes(market.id))
      : markets.data;
  const current = matches?.find((market) => market.id === selected);
  const selectedIndex =
    matches?.findIndex((market) => market.id === selected) ?? -1;
  const teamCount = new Set(matches?.flatMap((market) => market.outcomes) ?? [])
    .size;
  return (
    <div className="esports-app">
      <AppHeader
        active="esports"
        brand={
          <a href="/" className="nexus-brand">
            <Crosshair size={23} />
            NEXUS<span>INVITATIONAL</span>
          </a>
        }
      />
      <main id="main" className="esports-main">
        <div className="tournament-hero">
          <div>
            <div className="eyebrow">
              <Trophy size={14} />
              SEASON 04 · CHAMPIONSHIP WEEKEND
            </div>
            <h1>
              Built for the
              <br />
              <span>big moments.</span>
            </h1>
            <p>Follow the bracket. Back your team. Be part of the final.</p>
            <div className="tournament-facts">
              <span>
                <Swords size={13} />
                {teamCount} teams
              </span>
              <span>
                <CalendarDays size={13} />
                Exhibition series
              </span>
              <span>
                <Radio size={13} />
                Predictions live
              </span>
            </div>
          </div>
          <div className="tournament-emblem" aria-hidden="true">
            <Trophy size={85} strokeWidth={0.8} />
            <span>NEXUS</span>
            <small>CHAMPIONSHIP</small>
          </div>
        </div>
        <div className="tournament-layout">
          <div>
            <div className="section-heading">
              <h2>Match center</h2>
              <Badge tone="success">Tournament hub</Badge>
            </div>
            {markets.error && (
              <ErrorState
                error={markets.error}
                retry={() => {
                  void markets.refetch();
                }}
              />
            )}
            <Card className="featured-match">
              <div className="featured-top">
                <span>
                  {mode === "mock"
                    ? selectedIndex === 0
                      ? "GRAND FINAL · BEST OF FIVE"
                      : "SEMIFINAL · BEST OF THREE"
                    : "EXHIBITION MATCH"}
                </span>
                {current && <MarketStatus status={current.status} />}
              </div>
              <div className="team-versus">
                <div>
                  <TeamMark index={0} large />
                  <h3>{current?.outcomes[0] ?? "Outcome A"}</h3>
                  <span>CONTENDER 01</span>
                </div>
                <span className="versus-text">
                  VS<small>CHAMPIONSHIP</small>
                </span>
                <div>
                  <TeamMark index={1} large />
                  <h3>{current?.outcomes[1] ?? "Outcome B"}</h3>
                  <span>CONTENDER 02</span>
                </div>
              </div>
              <div className="featured-bottom">
                <span>
                  {current?.status === "resolved" &&
                  current.winningOutcome !== null
                    ? `${current.outcomes[current.winningOutcome]} advances`
                    : "The next chapter starts here."}
                </span>
                <span>
                  {current
                    ? `${formatTokens(current.totalPool)} TEST in pool`
                    : "Loading pool…"}
                </span>
              </div>
            </Card>
            <div className="match-list-head">
              <span>TOURNAMENT SCHEDULE</span>
              <span>{matches?.length ?? 0} MATCHES</span>
            </div>
            <div className="match-list">
              {markets.isPending && (
                <div className="match-skeleton" role="status">
                  Loading tournament matches…
                </div>
              )}
              {matches?.length === 0 && (
                <EmptyState title="No tournament markets">
                  Create a market in the developer console, then configure its
                  ID for this demo.
                </EmptyState>
              )}
              {matches?.map((market, index) => (
                <button
                  className={`match-row ${selected === market.id ? "match-row-selected" : ""}`}
                  key={market.id}
                  onClick={() => setSelected(market.id)}
                  aria-pressed={selected === market.id}
                >
                  <div className="match-round">
                    <span>0{index + 1}</span>
                    <small>
                      {mode === "mock"
                        ? index === 0
                          ? "FINAL"
                          : "SEMIFINAL"
                        : "MATCH"}
                    </small>
                  </div>
                  <div className="match-teams">
                    <span>
                      <TeamMark index={index * 2} />
                      {market.outcomes[0]}
                    </span>
                    <small>vs</small>
                    <span>
                      <TeamMark index={index * 2 + 1} />
                      {market.outcomes[1]}
                    </span>
                  </div>
                  <MarketStatus status={market.status} />
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            <div className="esports-integration">
              <div>
                <span className="kicker">
                  SAME INFRASTRUCTURE. DIFFERENT STAGE.
                </span>
                <h3>Predictions that belong in the action.</h3>
                <p>
                  This tournament embeds the same MarketKit component as the
                  racing league. One integration powers both experiences.
                </p>
              </div>
              <a
                href={appUrl("dashboard", "/integration")}
                aria-label="Open MarketKit integration documentation"
              >
                <ArrowUpRight size={23} />
              </a>
            </div>
          </div>
          <aside>
            <div className="section-heading">
              <h2>Your prediction</h2>
              <span>BY MARKETKIT</span>
            </div>
            <PredictionMarket key={selected} marketId={selected} />
            <div className="tournament-disclaimer">
              <span className="network-badge">
                <i />
                {mode === "mock" ? "Simulated tournament" : "Devnet tournament"}
              </span>
              <p>
                {mode === "mock"
                  ? "All matches, stakes, and settlement shown here are simulated. No blockchain transactions are submitted."
                  : "Predictions use nonredeemable Devnet TEST tokens. Results follow the authorized resolver."}
              </p>
            </div>
          </aside>
        </div>
        <footer className="app-footer">
          <span>Nexus Invitational · A MarketKit integration demo</span>
          <span>Competition, connected.</span>
        </footer>
      </main>
    </div>
  );
}

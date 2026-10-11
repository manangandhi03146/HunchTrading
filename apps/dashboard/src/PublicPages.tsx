import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Layers3, Share2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, MarketStatus, PredictionMarket, Skeleton, WalletButton, effectiveStatus, formatTokens, useHunch, useMarket, useMarkets, useNow } from "@hunch/react";
import { useTheme } from "../../shared/theme";
import { useState } from "react";

export function Home() {
  const { mode, client } = useHunch();
  const markets = useMarkets();
  const now = useNow();
  return <div className="public-home">
    <section className="home-hero"><Badge>Make your call</Badge><h1>Have a hunch?<br />Trade it.</h1><p>Create a question, pick an outcome, and follow the result together. {mode === "mock" ? client.shared ? "This shared demo uses simulated credits across browser sessions." : "This local demo uses simulated credits on this device." : "Predictions settle through shared pools on Solana Devnet."}</p><div className="public-actions"><Link className="hunch-button hunch-button-primary" to="/markets">Explore markets <ArrowRight size={16} /></Link><Link className="hunch-button hunch-button-secondary" to="/markets/new">Create a market</Link></div></section>
    <div className="home-steps">{[{ title: "Find your question", text: "Browse open markets or create one for your community." }, { title: "Back an outcome", text: "Review your stake and its possible payout before confirming." }, { title: "Follow the result", text: "An authorized result settles the pool. Winners claim their share." }].map((step, i) => <Card key={step.title}><span className="step-number">0{i + 1}</span><h2>{step.title}</h2><p>{step.text}</p></Card>)}</div>
    <section><div className="panel-heading"><h2>Discover markets</h2><Link to="/markets">View all <ArrowRight size={14} /></Link></div>{markets.error ? <ErrorState error={markets.error} retry={() => { void markets.refetch(); }} /> : markets.isPending ? <Skeleton /> : <div className="public-market-grid">{(markets.data ?? []).slice(0, 6).map(m => <Link className="public-market-link" key={m.id} to={`/markets/${encodeURIComponent(m.id)}`}><Card><MarketStatus status={effectiveStatus(m, now)} /><h3>{m.question}</h3><p>{m.outcomes.join(" / ")}</p><strong>{formatTokens(m.totalPool)} TEST pooled</strong><span>Open market <ArrowRight size={16} /></span></Card></Link>)}</div>}{markets.data?.length === 0 && <EmptyState title="The next question could be yours"><Link to="/markets/new">Create the first market</Link></EmptyState>}</section>
    <div className="home-demo-links"><Link to="/fortnite" className="home-demo-link"><span>WATCH & PREDICT</span><h2>A Fortnite finish. Your call.</h2><p>Watch SypherPK’s Twitch VOD with a Yes / No market and a modeled crowd reacting to match cues.</p><strong>Try the VOD exhibition <ArrowRight size={16} /></strong></Link><Link to="/funding" className="home-demo-link"><span>FUNDING & SOLANA</span><h2>Follow the tokens.</h2><p>Fund a demo account, model a token swap, and inspect stakes, escrow, and winner claims.</p><strong>Explore the funding flow <ArrowRight size={16} /></strong></Link></div>
    <Card className="home-builder"><Layers3 size={24} /><div><h2>Bring hunch into your product.</h2><p>Explore the VOD, racing, and esports demos, or embed a market in your own application.</p></div><Link to="/integration" className="hunch-button hunch-button-secondary">Developer tools</Link></Card>
  </div>;
}

export function MarketPage() {
  const { marketId = "" } = useParams();
  const query = useMarket(marketId);
  const { mode, client } = useHunch();
  const { theme } = useTheme();
  const [copyStatus, setCopyStatus] = useState("");
  async function share() {
    try { await navigator.clipboard.writeText(window.location.href); setCopyStatus("Market link copied."); }
    catch { setCopyStatus(`Copy this link: ${window.location.href}`); }
  }
  return <><Link className="panel-link" to="/markets">← All markets</Link>{query.isPending ? <Skeleton /> : query.error ? <ErrorState error={query.error} retry={() => { void query.refetch(); }} /> : query.data && <>
    <div className="page-title"><div><h1>{query.data.question}</h1><p>{query.data.description ?? "Pick an outcome and follow the shared pool."}</p></div><Button variant="secondary" onClick={() => { void share(); }}><Share2 size={16} /> Share market</Button></div><p role="status" className="share-status">{copyStatus}</p>
    <div className="market-detail-layout"><PredictionMarket marketId={marketId} theme={theme} /><Card className="market-facts"><h2>About this market</h2><dl><dt>Predictions close</dt><dd>{new Date(query.data.closesAt * 1000).toLocaleString()}</dd><dt>Total pool</dt><dd>{formatTokens(query.data.totalPool)} TEST</dd><dt>Settlement</dt><dd>{query.data.status === "resolved" ? `Winner: ${query.data.outcomes[query.data.winningOutcome ?? 0]}` : "Waiting for an authorized result after the deadline."}</dd><dt>Market ID</dt><dd className="break-id">{marketId}</dd></dl><p>{mode === "mock" ? client.shared ? "Shared simulated credits. Anyone using this backend can open this market link. The development ledger resets when the backend restarts." : "Simulated credits. This local-only demo stays on this device." : "Solana Devnet test tokens. No cash value."}</p><Link to={`/integration?market=${encodeURIComponent(marketId)}`}>Embed this market <ArrowRight size={14} /></Link></Card></div>
  </>}</>;
}

export function Portfolio() {
  const { client, walletAddress, mode } = useHunch();
  const markets = useMarkets();
  const positions = useQuery({ queryKey: ["portfolio", client.mode, walletAddress, markets.data?.map(m => m.id).join(",")], enabled: !!walletAddress && !!markets.data, queryFn: async () => {
    const entries = await Promise.all((markets.data ?? []).map(async market => ({ market, positions: await client.getPositions(market.id, walletAddress!) })));
    return entries.filter(entry => entry.positions.length > 0);
  }, refetchInterval: 10000 });
  return <><div className="page-title"><div><h1>Your predictions</h1><p>Follow your positions and open resolved markets to claim winnings.</p></div><WalletButton /></div>{!walletAddress ? <EmptyState title={mode === "mock" ? "Connect your demo account" : "Connect your wallet"}>Your positions appear here after connecting.</EmptyState> : markets.error || positions.error ? <ErrorState error={markets.error ?? positions.error} retry={() => { void markets.refetch(); void positions.refetch(); }} /> : markets.isPending || positions.isPending ? <Skeleton /> : !positions.data?.length ? <EmptyState title="Your first prediction starts here"><Link to="/markets" className="hunch-button hunch-button-primary">Explore markets</Link></EmptyState> : <div className="portfolio-list">{positions.data.map(({ market, positions: list }) => <Card key={market.id}><h2><Link to={`/markets/${encodeURIComponent(market.id)}`}>{market.question}</Link></h2>{list.map(p => <div className="portfolio-position" key={p.outcome}><span>{market.outcomes[p.outcome]}</span><strong>{formatTokens(p.amount)} TEST staked</strong><Badge>{p.claimed ? "Claimed" : market.status === "resolved" ? market.winningOutcome === p.outcome ? "Winner · open to claim" : "Lost" : "Awaiting result"}</Badge></div>)}<Link className="panel-link" to={`/markets/${encodeURIComponent(market.id)}`}>View position <ArrowRight size={14} /></Link></Card>)}</div>}</>;
}

export function Help() { return <><div className="page-title"><div><h1>How hunch works</h1><p>From a question to a confirmed result.</p></div></div><div className="help-grid">{[{ title: "Create", text: "Give your market a clear question, two distinct outcomes, and a future deadline. Share its dedicated page with your community." }, { title: "Predict", text: "Connect an account, choose an outcome, and stake whole TEST tokens. Your estimate changes as other people join the pool." }, { title: "Resolve", text: "Only an authorized resolver can submit the result. In live mode it verifies a signed backend event; the browser cannot choose a winner." }, { title: "Claim", text: "Winning stakes receive their proportional share of the total pool, rounded down to whole tokens. Open a resolved market to claim once." }].map(item => <Card key={item.title}><CheckCircle2 size={20} /><h2>{item.title}</h2><p>{item.text}</p></Card>)}</div><Card className="home-builder"><p>Demo credits and Devnet TEST tokens have no cash value. Browser-local demo state stays on this device. A hosted app needs the shared API or live Devnet configuration.</p><Link to="/markets">Explore markets</Link></Card></>; }
export function NotFound() { return <EmptyState title="This page does not exist"><Link className="hunch-button hunch-button-primary" to="/">Back to hunch</Link></EmptyState>; }

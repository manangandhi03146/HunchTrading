import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, ShieldCheck, Play, Pause } from "lucide-react";
import { CREATORS, getCreator, type Creator } from "./creators";
import { FortniteDemo } from "./FortniteDemo";
import { TwitchVod } from "./TwitchVod";
import "./demos.css";
export function CreatorDirectory() {
  const [game, setGame] = useState("all");
  return <section className="creator-directory">
    <div className="panel-heading"><div><h2>Follow the creator. Call the match.</h2><p>Explore Twitch partner channels and build a market around their featured gameplay.</p></div>
      <label>Game <select aria-label="Filter creators by game" value={game} onChange={e => setGame(e.target.value)}><option value="all">All games</option>{[...new Set(CREATORS.map(c => c.game))].map(game => <option key={game}>{game}</option>)}</select></label></div>
    <div className="creator-grid">{CREATORS.filter(c => game === "all" || c.game === game).map(c => <Link key={c.slug} to={`/creators/${c.slug}`} className="creator-card">
      <span className="creator-game">{c.game}</span><span className="creator-avatar">{c.name.slice(0, 1)}</span>
      <h3>{c.name} <ShieldCheck size={18} aria-label="Twitch Verified Partner" /></h3><span className="creator-verification">Twitch Verified Partner</span><p>{c.about}</p><strong>{c.question}</strong><span className="panel-link">Open creator & match <ArrowRight size={15} /></span>
    </Link>)}</div>
    <p className="demo-caption">Partner badges identify Twitch channels. These are independent Hunch demos, with no creator endorsement. Markets you create are not verified by that badge.</p>
  </section>;
}
export function CreatorPage() {
  const { creatorId } = useParams();
  const creator = getCreator(creatorId);
  if (!creator) return <><h1>Creator not found</h1><Link to="/markets">Browse creators</Link></>;
  return <FortniteDemo key={creator.slug} creator={creator} />;
}
export function MarketBroadcast({ creator }: { creator: Creator }) {
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  return <section className="demo-panel linked-market-broadcast"><h2>{creator.name} · {creator.game}</h2>
    <TwitchVod source={creator.source} playing={playing} seekTo={creator.source.start} onReady={setReady} onTime={(_, paused) => { if (ready) setPlaying(!paused); }} />
    <button type="button" className="hunch-button hunch-button-secondary" onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? "Pause gameplay" : "Play gameplay"}</button>
    <p className="demo-caption">Creator-linked gameplay reference. This market’s pools reflect submitted stakes; playback does not simulate trades or resolve it. The authorized resolver must verify the selected match result.</p>
  </section>;
}

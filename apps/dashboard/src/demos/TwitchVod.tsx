import { useEffect, useRef, useState } from "react";
export const VOD = {
  id: "2895387839",
  channel: "SypherPK",
  start: 1800,
  url: "https://www.twitch.tv/videos/2895387839",
  title: "THE BEST 30 YEAR OLD FORTNITE PLAYER IN THE WORLD",
};
export type BroadcastSource = { id: string; channel: string; start: number; url: string; title: string };
type Player = {
  getCurrentTime(): number;
  isPaused(): boolean;
  play(): void;
  pause(): void;
  seek(second: number): void;
  addEventListener(event: string, handler: () => void): void;
  removeEventListener(event: string, handler: () => void): void;
};
type TwitchAPI = {
  Player: {
    new (element: HTMLElement, options: Record<string, unknown>): Player;
    READY: string;
    PLAYBACK_BLOCKED: string;
      PLAYING: string;
  };
};
declare global {
  interface Window {
    Twitch?: TwitchAPI;
  }
}
let loading: Promise<TwitchAPI> | undefined;
function loadPlayer() {
  if (window.Twitch) return Promise.resolve(window.Twitch);
  if (!loading)
    loading = new Promise<TwitchAPI>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://player.twitch.tv/js/embed/v1.js";
      script.async = true;
      const timeout = window.setTimeout(() => {
        script.remove();
        loading = undefined;
        reject(new Error("Twitch took too long to respond."));
      }, 15_000);
      script.onload = () => {
        clearTimeout(timeout);
        if (window.Twitch) resolve(window.Twitch);
        else {
          loading = undefined;
          reject(new Error("Twitch player is unavailable."));
        }
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        loading = undefined;
        reject(new Error("Twitch could not be loaded."));
      };
      document.head.append(script);
    });
  return loading;
}
export function TwitchVod({
  onTime,
  onReady,
  playing,
  seekTo,
  source = VOD,
}: {
  source?: BroadcastSource;
  onTime: (second: number, paused: boolean) => void;
  onReady: (ready: boolean) => void;
  playing: boolean;
  seekTo: number | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const callbacks = useRef({ onTime, onReady });
  callbacks.current = { onTime, onReady };
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let instance: Player | undefined;
    setError("");
    setReady(false);
    callbacks.current.onReady(false);
    void loadPlayer()
      .then((api) => {
        if (disposed || !host.current) return;
        instance = new api.Player(host.current, {
          video: `v${source.id}`,
          parent: [location.hostname],
          width: "100%",
          height: "100%",
          autoplay: false,
          muted: true,
          time: `${Math.floor(source.start / 3600)}h${Math.floor(source.start / 60) % 60}m${source.start % 60}s`,
        });
        player.current = instance;
        const markReady = () => {
          if (disposed) return;
          setReady(true);
          callbacks.current.onReady(true);
        };
        instance.addEventListener(api.Player.READY, markReady);
        instance.addEventListener(api.Player.PLAYBACK_BLOCKED, () => {
          if (!disposed) setError("Click Play inside the Twitch player to start the broadcast. The presentation clock can continue separately.");
        });
        instance.addEventListener(api.Player.PLAYING, () => {
          if (!disposed) setError("");
        });
        interval = setInterval(() => {
          if (disposed || !instance) return;
          try {
            callbacks.current.onTime(
              instance.getCurrentTime(),
              instance.isPaused(),
            );
          } catch {
            /* Wait for player readiness. */
          }
        }, 1_000);
      })
      .catch((e) => {
        if (!disposed)
          setError(e instanceof Error ? e.message : "Twitch is unavailable.");
      });
    return () => {
      disposed = true;
      clearInterval(interval);
      try {
        instance?.pause();
      } catch {
        /* Iframe may already be gone. */
      }
      player.current = null;
      host.current?.replaceChildren();
    };
  }, [attempt, source.id, source.start]);
  useEffect(() => {
    if (!ready || !player.current) return;
    try {
      playing ? player.current.play() : player.current.pause();
    } catch {
      setError("Use the Twitch player controls to start playback.");
    }
  }, [playing, ready]);
  useEffect(() => {
    if (!ready || !player.current || seekTo === null) return;
    try {
      player.current.seek(seekTo);
    } catch {
      /* User can seek using Twitch controls. */
    }
  }, [seekTo, ready]);
  return (
    <>
      <div className="vod-player" aria-label={`${source.channel} demo broadcast`}>
        <div ref={host} className="vod-mount" />
      </div>
      {error && (
        <div className="demo-inline-notice" role="status">
          {error}{" "}
          <button
            className="demo-text-button"
            onClick={() => setAttempt((a) => a + 1)}
          >
            Retry player
          </button>
        </div>
      )}
      <div className="vod-attribution">
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          Watch original on Twitch ↗
        </a>
        <span>Recorded gameplay. No streamer endorsement.</span>
      </div>
    </>
  );
}

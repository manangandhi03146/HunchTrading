import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HunchProvider, HttpHunchClient, type HunchClient, type Mode } from "@hunch/react";
import App from "./App";
import { ThemeProvider } from "../../shared/theme";
import "./styles.css";
import "./layout.css";

const mode = import.meta.env.VITE_HUNCH_MODE ?? "mock";
const cluster = import.meta.env.VITE_SOLANA_CLUSTER ?? "devnet";
const root = ReactDOM.createRoot(document.getElementById("root")!);
function Application() {
  const [client, setClient] = React.useState<HunchClient>();
  const [error, setError] = React.useState("");
  const [local, setLocal] = React.useState(new URLSearchParams(location.search).get("demo") === "local");
  const [attempt, setAttempt] = React.useState(0);
  // Static hosts serve the SPA, not the resolver. Only use shared state when
  // its API (or a same-origin proxy) has been explicitly configured.
  const api = import.meta.env.VITE_HUNCH_DEMO_API_URL?.trim().replace(/\/+$/, "");
  React.useEffect(() => {
    if (mode !== "mock" || local || !api) return;
    let active = true;
    setError("");
    void HttpHunchClient.connect(api).then(c => { if (active) setClient(c); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Shared backend is unavailable."); });
    return () => { active = false; };
  }, [api, mode, local, attempt]);
  if (mode === "mock" && !local && api && !client) return <main className="startup-error"><h1>{error ? "Shared demo is unavailable" : "Connecting to hunch…"}</h1><p>{error ? "We couldn’t connect to the shared demo. Try again, or use this device’s local demo. Local markets and balances stay on this device." : "Loading shared markets and your simulated participant account."}</p>{error && <><button className="hunch-button hunch-button-primary" onClick={() => setAttempt(a => a + 1)}>Retry connection</button><button className="hunch-button hunch-button-secondary" onClick={() => setLocal(true)}>Use this device’s local demo</button></>}</main>;
  return <HunchProvider mode={mode as Mode} client={local ? undefined : client} programId={import.meta.env.VITE_HUNCH_PROGRAM_ID} tokenMint={import.meta.env.VITE_TEST_TOKEN_MINT} rpcUrl={import.meta.env.VITE_SOLANA_RPC_URL}><BrowserRouter><App /></BrowserRouter></HunchProvider>;
}
if ((mode !== "mock" && mode !== "sdk") || cluster !== "devnet") {
  root.render(
    <main className="startup-error">
      <h1>Check your frontend configuration</h1>
      <p>
        Use VITE_HUNCH_MODE=mock or sdk and VITE_SOLANA_CLUSTER=devnet. hunch
        only supports Devnet test tokens.
      </p>
    </main>,
  );
} else {
  root.render(
    <React.StrictMode>
      <ThemeProvider>
        <Application />
      </ThemeProvider>
    </React.StrictMode>,
  );
}
import "./public.css";

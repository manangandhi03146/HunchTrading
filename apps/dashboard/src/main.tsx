import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MarketKitProvider, type Mode } from "@marketkit/react";
import App from "./App";
import "./styles.css";

const mode = import.meta.env.VITE_MARKETKIT_MODE ?? "mock";
const cluster = import.meta.env.VITE_SOLANA_CLUSTER ?? "devnet";
const root = ReactDOM.createRoot(document.getElementById("root")!);
if ((mode !== "mock" && mode !== "sdk") || cluster !== "devnet") {
  root.render(
    <main className="startup-error">
      <h1>Check your frontend configuration</h1>
      <p>
        Use VITE_MARKETKIT_MODE=mock or sdk and VITE_SOLANA_CLUSTER=devnet.
        hunch only supports Devnet test tokens.
      </p>
    </main>,
  );
} else {
  root.render(
    <React.StrictMode>
      <MarketKitProvider
        mode={mode as Mode}
        programId={import.meta.env.VITE_MARKETKIT_PROGRAM_ID}
        tokenMint={import.meta.env.VITE_TEST_TOKEN_MINT}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MarketKitProvider>
    </React.StrictMode>,
  );
}

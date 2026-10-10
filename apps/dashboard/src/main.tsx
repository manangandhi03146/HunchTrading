import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HunchProvider, type Mode } from "@hunch/react";
import App from "./App";
import { ThemeProvider } from "../../shared/theme";
import "./styles.css";
import "./layout.css";

const mode = import.meta.env.VITE_HUNCH_MODE ?? "mock";
const cluster = import.meta.env.VITE_SOLANA_CLUSTER ?? "devnet";
const root = ReactDOM.createRoot(document.getElementById("root")!);
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
        <HunchProvider
          mode={mode as Mode}
          programId={import.meta.env.VITE_HUNCH_PROGRAM_ID}
          tokenMint={import.meta.env.VITE_TEST_TOKEN_MINT}
        >
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </HunchProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}

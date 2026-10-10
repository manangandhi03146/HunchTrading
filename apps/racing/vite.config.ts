import { defineConfig } from "vite";
import { themeBootstrap } from "../shared/theme-bootstrap";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [themeBootstrap(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@hunch/react": fileURLToPath(
        new URL("../../packages/react/src/index.ts", import.meta.url),
      ),
      "@hunch/sdk": fileURLToPath(
        new URL("../../packages/sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "query-vendor": ["@tanstack/react-query"],
          "solana-vendor": ["@solana/web3.js"],
          "wallet-vendor": [
            "@solana/wallet-adapter-react",
            "@solana/wallet-adapter-react-ui",
            "@solana/wallet-adapter-phantom",
            "@solana/wallet-adapter-solflare",
          ],
        },
      },
    },
  },
});

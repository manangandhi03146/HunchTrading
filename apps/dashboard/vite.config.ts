import { defineConfig } from "vite";
import { themeBootstrap } from "../shared/theme-bootstrap";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  server: { proxy: { "/v1": { target: "http://127.0.0.1:8787", changeOrigin: true }, "/health": { target: "http://127.0.0.1:8787", changeOrigin: true } } },
  plugins: [themeBootstrap(), react(), tailwindcss()],
  resolve: {
    alias: [
      {find: /^buffer$/, replacement: "buffer/index.js"},
      {find: "@hunch/react", replacement: fileURLToPath(
        new URL("../../packages/react/src/index.ts", import.meta.url),
      )},
      {find: "@hunch/sdk", replacement: fileURLToPath(
        new URL("../../packages/sdk/src/index.ts", import.meta.url),
      )},
    ],
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

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// nodePolyfills({ include: ["buffer"] }) matches mango-bridge.jsx's own
// vite.config.js exactly — @solana/web3.js expects Node's Buffer global,
// which Vite doesn't provide automatically, and the site already hit
// (and fixed) the resulting "Buffer is not defined" crash during real
// Solana transaction execution. Scoped to just 'buffer' there for the
// same reason: polyfill the confirmed need, not everything.
export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer"] })],
  build: {
    sourcemap: true,
  },
});

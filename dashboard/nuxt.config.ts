import { resolve } from "path";

export default defineNuxtConfig({
  compatibilityDate: "2025-05-01",
  modules: ["@nuxt/ui", "@nuxt/content"],
  devtools: { enabled: true },
  devServer: { host: "::" },
  ssr: false,
  css: ["~/assets/css/main.css"],

  app: {
    baseURL: "/",
    head: {
      title: "AriLink Dashboard",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
      ],
    },
  },

  // Server-only runtime config
  runtimeConfig: {
    projectRoot: resolve(__dirname, ".."),
  },

  nitro: {
    // Enable WebSocket support so Socket.IO upgrades reach the Nitro plugin
    experimental: { websocket: true },
    // Aliases so server code can import from core/, assistants/, tools/
    alias: {
      "#core": resolve(__dirname, "../core"),
      "#assistants": resolve(__dirname, "../assistants"),
      "#tools": resolve(__dirname, "../tools"),
    },
    // Native/complex modules that Nitro must NOT bundle
    externals: {
      external: [
        "better-sqlite3",
        "ari-client",
        "@google-cloud/speech",
        "ws",
        "ssh2",
        "ssh2-sftp-client",
        "ai",
        "@ai-sdk/mistral",
        "@ai-sdk/vue",
        "zod",
        "@modelcontextprotocol/sdk",
      ],
    },
    // Direct Rollup externals — prevents Rollup from parsing native .node addons
    rollupConfig: {
      external: ["ssh2", "ssh2-sftp-client", /\.node$/],
    },
  },

  // Vite HMR for Windows
  vite: {
    server: {
      hmr: { protocol: "ws" },
      watch: { usePolling: true, interval: 1000 },
    },
    optimizeDeps: {
      include: ["monaco-editor", "markdown-it", "mermaid", "sip.js"],
    },
  },
});

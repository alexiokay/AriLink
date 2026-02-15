// Dev launcher that preloads network error suppressor into ALL Node.js processes
// (parent Nuxt CLI, forked Nitro workers, etc.) via NODE_OPTIONS.
// Also pre-spawns Parakeet in parallel so the CUDA model loads while Nuxt builds.
// Usage: node tools/dev-launcher.cjs [-- extra nuxt args]

"use strict";

const path = require("path");
const { spawn } = require("child_process");

// Load .env so we can check AUTO_START_TRANSCRIPTION before Nuxt starts
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Convert to forward slashes — Windows NODE_OPTIONS strips backslashes from --require paths
const suppressorPath = path.resolve(__dirname, "suppress-network-errors.cjs").replace(/\\/g, "/");

// Append --require to NODE_OPTIONS so every forked process also gets the suppressor
const existing = process.env.NODE_OPTIONS || "";
process.env.NODE_OPTIONS = `${existing} --require "${suppressorPath}"`.trim();

const { spawnParakeet } = require("./spawn-parakeet.cjs");
let parakeetProc = null;

(async () => {
  // Await so PARAKEET_PRE_SPAWNED is set in env before Nuxt inherits it
  parakeetProc = await spawnParakeet();

  // Forward any extra args (e.g. --port 3011)
  const extraArgs = process.argv.slice(2);
  const nuxtArgs = ["nuxt", "dev", "--port", "3011", ...extraArgs];

  const child = spawn("npx", nuxtArgs, {
    cwd: path.resolve(__dirname, "../dashboard"),
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  function cleanup(code) {
    if (parakeetProc && typeof parakeetProc.kill === "function") {
      parakeetProc.kill("SIGTERM");
    }
    process.exit(code || 0);
  }

  child.on("exit", cleanup);
  child.on("error", (err) => {
    console.error("Failed to start Nuxt dev server:", err.message);
    cleanup(1);
  });

  // Clean up Parakeet on SIGINT/SIGTERM
  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));
})();

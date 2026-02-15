// Production launcher that preloads the network error suppressor
// and pre-spawns Parakeet before starting the built Nitro server.
// Automatically builds if .output doesn't exist yet.
// Usage: node tools/start-launcher.cjs

"use strict";

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// Load .env so we can check AUTO_START_TRANSCRIPTION
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Preload network error suppressor (same as dev-launcher.cjs)
const suppressorPath = path.resolve(__dirname, "suppress-network-errors.cjs").replace(/\\/g, "/");
const existing = process.env.NODE_OPTIONS || "";
process.env.NODE_OPTIONS = `${existing} --require "${suppressorPath}"`.trim();

const serverPath = path.resolve(__dirname, "../dashboard/.output/server/index.mjs");

async function startServer() {
  // Await so PARAKEET_PRE_SPAWNED is set in env before Nitro inherits it
  const { spawnParakeet } = require("./spawn-parakeet.cjs");
  const parakeetProc = await spawnParakeet();

  const child = spawn("node", [serverPath], {
    stdio: "inherit",
    shell: false,
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
    console.error("Failed to start production server:", err.message);
    cleanup(1);
  });

  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));
}

// Build first if output doesn't exist
if (!fs.existsSync(serverPath)) {
  console.log("[Start] No build output found, building first...");
  const buildLauncher = path.resolve(__dirname, "build-launcher.cjs");
  const build = spawn("node", [buildLauncher], {
    stdio: "inherit",
    env: process.env,
  });
  build.on("exit", (code) => {
    if (code !== 0) {
      console.error("[Start] Build failed with code " + code);
      process.exit(code || 1);
    }
    startServer();
  });
} else {
  startServer();
}

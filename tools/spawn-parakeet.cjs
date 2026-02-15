// Spawns Parakeet transcription service if configured.
// Used by dev-launcher.cjs and start-launcher.cjs to start Parakeet
// in parallel with Nuxt, so the model loads while Nuxt builds.
//
// Returns the child process (or null if not configured / already running).

"use strict";

const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");

function checkTcpPort(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.on("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.on("error", () => { clearTimeout(timer); socket.destroy(); resolve(false); });
  });
}

async function spawnParakeet() {
  const autoStart = process.env.AUTO_START_TRANSCRIPTION === "true";
  if (!autoStart) return null;

  // Parse first transcription service URL
  const raw = process.env.TRANSCRIPTION_SERVICES || "";
  const firstService = raw.split(",")[0].trim();
  if (!firstService || firstService === "google" || !firstService.startsWith("ws://")) return null;

  let host, port;
  try {
    const parsed = new URL(firstService);
    host = parsed.hostname;
    port = parseInt(parsed.port, 10) || 5000;
  } catch {
    return null;
  }

  // Only auto-spawn for local services
  if (!["localhost", "127.0.0.1", "0.0.0.0"].includes(host)) return null;

  const probeHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const alreadyRunning = await checkTcpPort(probeHost, port);
  if (alreadyRunning) {
    console.log("[Launcher] Parakeet already running on port " + port + ", reusing");
    return null;
  }

  const rootDir = path.resolve(__dirname, "..");
  const isWin = process.platform === "win32";
  const serviceDir = path.resolve(rootDir, "transcription-services/parakeet-service");
  const venvPython = isWin
    ? path.resolve(serviceDir, ".venv/Scripts/python.exe")
    : path.resolve(serviceDir, ".venv/bin/python");

  if (!fs.existsSync(venvPython)) {
    console.log("[Launcher] Parakeet venv not found, skipping pre-spawn");
    return null;
  }

  const device = process.env.TRANSCRIPTION_DEVICE || "cuda";
  const args = [
    "server.py",
    "--model", "nvidia/parakeet-tdt-0.6b-v3",
    "--device", device,
    "--host", "0.0.0.0",
    "--port", String(port),
  ];

  // Signal to the Engine that the launcher is handling Parakeet
  process.env.PARAKEET_PRE_SPAWNED = "true";

  console.log("[Launcher] Pre-spawning Parakeet (parallel with Nuxt)...");
  const proc = spawn(venvPython, args, {
    cwd: serviceDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  proc.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (line) console.log("[Parakeet] " + line);
    }
  });
  proc.stderr.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (line) console.log("[Parakeet] " + line);
    }
  });
  proc.on("exit", (code) => {
    console.log("[Launcher] Parakeet exited with code " + code);
  });
  proc.on("error", (err) => {
    console.error("[Launcher] Failed to spawn Parakeet:", err.message);
  });

  return proc;
}

module.exports = { spawnParakeet };

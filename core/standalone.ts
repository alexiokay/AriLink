/**
 * Standalone entry point — runs the Engine without Nuxt/Nitro.
 *
 * Usage:
 *   npx tsx core/standalone.ts
 *
 * The engine creates its own HTTP + Socket.IO server.
 * Dashboard SPA connects to ws://host:ENGINE_PORT from anywhere.
 *
 * Environment:
 *   ENGINE_PORT  — Socket.IO port (default: 3012)
 *   PBX_IP       — FreePBX address
 *   ...all other .env vars (loaded automatically from project root)
 */

const { Engine } = require("./Engine");

const engine = new Engine();

engine.start().catch((err: any) => {
  console.error("[Standalone] Failed to start:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.log("\n[Standalone] Caught SIGINT, shutting down...");
  await engine.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("[Standalone] Caught SIGTERM, shutting down...");
  await engine.stop();
  process.exit(0);
});

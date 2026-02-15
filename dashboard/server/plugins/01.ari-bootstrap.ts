import { createRequire } from "module";
import { resolve } from "path";

// Workaround: import.meta.url may be empty in Nitro's esbuild es2019 target
const _require = createRequire(
  "file:///" + process.cwd().replace(/\\/g, "/") + "/"
);

// State stored on `process` — the only object guaranteed to survive Nitro dev rebuilds
// (globalThis, module scope, and serverState all get recreated)
const P = process as any;

// NOTE: Network error suppression (ECONNRESET etc) is handled by
// tools/suppress-network-errors.cjs, preloaded via NODE_OPTIONS in dev-launcher.cjs.

export default defineNitroPlugin(async (nitroApp) => {

  // ── Idempotency: skip if already bootstrapped in this process ──
  if (P.__ariBootstrapped) {
    console.log("[Bootstrap] Already running in this process, skipping");
    return;
  }
  P.__ariBootstrapped = true;

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;

  console.log("[Bootstrap] Starting engine...");
  console.log(`[Bootstrap] Project root: ${rootDir}`);

  // Register tsx so core TypeScript files can be require()'d at runtime (Node.js 22+)
  try {
    _require(resolve(rootDir, "node_modules/tsx/dist/cjs/index.cjs"));
  } catch (err: any) {
    console.error("[Bootstrap] Failed to register tsx:", err.message);
    P.__ariBootstrapped = false;
    return;
  }

  // Get Socket.IO instance from 00.socket-io.ts plugin
  const io = (globalThis as any).__socketIO;
  if (!io) {
    console.error("[Bootstrap] Socket.IO not initialized! Check 00.socket-io.ts plugin");
    P.__ariBootstrapped = false;
    return;
  }

  // Import and start the Engine (embedded mode — uses Nitro's Socket.IO)
  const { Engine } = _require(resolve(rootDir, "core/Engine"));
  const engine = new Engine({ io, rootDir });

  try {
    await engine.start();
  } catch (err: any) {
    console.error("[Bootstrap] Engine failed to start:", err.message);
    P.__ariBootstrapped = false;
    return;
  }

  // Populate serverState so API routes can access core services
  serverState.controller = engine.getController();
  serverState.callHistory = engine.getCallHistory();
  serverState.dashboard = engine.getDashboard();
  serverState.rustProcess = engine.getRustProcess();

  // Store engine ref on process for cleanup
  P.__engine = engine;

  // Graceful shutdown
  nitroApp.hooks.hook("close", async () => {
    console.log("[Bootstrap] Shutting down engine...");
    P.__ariBootstrapped = false;
    await engine.stop();
    serverState.controller = null;
    serverState.callHistory = null;
    serverState.dashboard = null;
    serverState.rustProcess = null;
  });
});

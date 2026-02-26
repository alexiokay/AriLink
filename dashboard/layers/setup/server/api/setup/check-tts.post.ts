/**
 * Lightweight Kokoro TTS health check — WebSocket open/close, no synthesis.
 * Used for auto-detection in the config UI. Cloud providers (ElevenLabs)
 * are validated via the "Test TTS" button instead.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ wsUrl?: string }>(event);
  const wsUrl = body.wsUrl || process.env.TTS_SERVICE;

  if (!wsUrl) {
    return { available: false, reason: "no_url", message: "Set a Kokoro service URL (e.g. ws://localhost:5001)" };
  }

  try {
    const WebSocket = (await import("ws")).default;

    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        resolve({ available: false, reason: "timeout", message: `Kokoro not reachable at ${wsUrl} — is the service running?` });
      }, 3000);

      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        resolve({ available: true, message: `Kokoro running at ${wsUrl}` });
      });

      ws.on("error", (err: any) => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        const msg = err.message || String(err);
        if (msg.includes("ECONNREFUSED")) {
          resolve({
            available: false,
            reason: "not_running",
            message: `Kokoro not running at ${wsUrl}`,
            hint: "Start it with: docker compose up kokoro -d",
          });
        } else {
          resolve({ available: false, reason: "error", message: msg });
        }
      });
    });
  } catch (err: any) {
    return { available: false, reason: "error", message: err.message || String(err) };
  }
});

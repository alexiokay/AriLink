/**
 * Transcription service health check — HTTP GET /health.
 * Returns service identity (name, model, device) so the UI can verify
 * the running service matches the selected provider.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ provider?: string; wsUrl?: string }>(event);
  const provider = body.provider || "parakeet";
  const wsUrl = body.wsUrl || process.env.TRANSCRIPTION_SERVICES?.split(",")[0]?.trim();

  if (!wsUrl) {
    return { available: false, reason: "no_url", message: `Set a service URL (e.g. ws://localhost:5000)` };
  }

  try {
    // Convert ws:// to http:// for health check and strip /ws suffix if present
    const httpUrl = wsUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/ws$/, "");
    const res = await fetch(`${httpUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });

    if (res.ok) {
      // Try to parse JSON health response with service identity
      try {
        const health = await res.json() as {
          service?: string;
          model?: string;
          device?: string;
          status?: string;
        };

        const actualService = health.service || "unknown";
        const model = health.model || "";
        const device = health.device || "";

        // Check if the running service matches the selected provider
        const mismatch = provider !== "custom"
          && actualService !== "unknown"
          && actualService !== provider;

        if (mismatch) {
          return {
            available: true,
            mismatch: true,
            actualService,
            model,
            device,
            message: `Expected ${provider} but found ${actualService} (${model}) at ${wsUrl}`,
          };
        }

        const label = actualService === "whisper" ? "Whisper" : actualService === "parakeet" ? "Parakeet" : actualService;
        return {
          available: true,
          actualService,
          model,
          device,
          message: `${label} running — ${model || "unknown model"} on ${device || "unknown device"}`,
        };
      } catch {
        // Non-JSON 200 response — service is reachable but doesn't identify itself
        const label = provider === "whisper" ? "Whisper" : "Parakeet";
        return { available: true, message: `${label} reachable at ${wsUrl}` };
      }
    }

    // Non-200 but reachable — old service without /health handler
    return { available: true, message: `Service reachable at ${wsUrl} (status ${res.status})` };
  } catch (err: any) {
    const msg = err.message || String(err);
    const label = provider === "whisper" ? "Whisper" : provider === "custom" ? "Service" : "Parakeet";

    if (msg.includes("ECONNREFUSED")) {
      return {
        available: false,
        reason: "not_running",
        message: `${label} not running at ${wsUrl}`,
        hint: provider === "whisper"
          ? "Start it with: cd transcription-services/whisper-service && python app.py"
          : provider === "custom"
            ? "Make sure the transcription service is running"
            : "Start it with: docker compose up parakeet -d",
      };
    }

    if (msg.includes("timeout") || msg.includes("TimeoutError")) {
      return {
        available: false,
        reason: "timeout",
        message: `${label} not reachable at ${wsUrl} — is the service running?`,
      };
    }

    return { available: false, reason: "error", message: msg };
  }
});

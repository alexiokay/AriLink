export default defineEventHandler(async (event) => {
  const body = await readBody<{
    url: string;
    type: "parakeet" | "google" | "whisper" | "custom";
  }>(event);

  if (!body.type) {
    throw createError({ statusCode: 400, message: "Missing service type" });
  }

  // Google Cloud Speech — check credentials are configured
  if (body.type === "google") {
    // Materialize credentials file from base64 env var
    const filePath = materializeGoogleCredentials();
    if (!filePath) {
      return { success: false, error: "No Google credentials configured — paste your service account JSON in the Transcription settings" };
    }
    const summary = getGoogleCredentialsSummary();
    return {
      success: true,
      actualService: "google",
      model: summary?.projectId || "",
      device: summary?.clientEmail || "",
    };
  }

  // Parakeet / Whisper / Custom — test HTTP health endpoint
  if (!body.url) {
    return { success: false, error: "Missing service URL" };
  }

  try {
    const httpUrl = body.url.replace(/^ws(s?):\/\//, "http$1://").replace(/\/ws$/, "");
    const res = await fetch(`${httpUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      // Try to parse health JSON for service identity
      try {
        const health = await res.json() as {
          service?: string;
          model?: string;
          device?: string;
        };

        const actualService = health.service || "unknown";

        // Warn if mismatch (but still success — service IS reachable)
        const mismatch = body.type !== "custom"
          && actualService !== "unknown"
          && actualService !== body.type;

        return {
          success: true,
          actualService,
          model: health.model || "",
          device: health.device || "",
          mismatch,
          mismatchMessage: mismatch
            ? `Warning: expected ${body.type} but service reports "${actualService}"`
            : undefined,
        };
      } catch {
        return { success: true };
      }
    }

    // Non-200 but reachable
    return { success: true };
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes("ECONNREFUSED")) {
      return { success: false, error: `Service not reachable at ${body.url} — make sure the transcription service is running` };
    }
    if (msg.includes("timeout") || msg.includes("TimeoutError")) {
      return { success: false, error: `Connection timed out reaching ${body.url} — check the URL and ensure the service is running` };
    }
    return { success: false, error: msg };
  }
});

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    url: string;
    type: "parakeet" | "google" | "whisper";
  }>(event);

  if (!body.type) {
    throw createError({ statusCode: 400, message: "Missing service type" });
  }

  // Google Cloud Speech — just check that the credentials env var or path is set
  if (body.type === "google") {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credPath) {
      return { success: false, error: "GOOGLE_APPLICATION_CREDENTIALS not set" };
    }
    try {
      const { existsSync } = await import("fs");
      if (!existsSync(credPath)) {
        return { success: false, error: `Credentials file not found: ${credPath}` };
      }
      return { success: true };
    } catch {
      return { success: false, error: "Could not verify credentials file" };
    }
  }

  // Parakeet / Whisper — test WebSocket or HTTP health endpoint
  if (!body.url) {
    return { success: false, error: "Missing service URL" };
  }

  try {
    // Try HTTP health check first (works for both services)
    const httpUrl = body.url.replace(/^ws(s?):\/\//, "http$1://").replace(/\/ws$/, "");
    const res = await fetch(`${httpUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      return { success: true };
    }

    // Even a non-200 means the server is reachable
    return { success: true };
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes("ECONNREFUSED")) {
      return { success: false, error: `Service not reachable at ${body.url} — make sure the transcription service is running (e.g. cd transcription-services/parakeet-service && python app.py)` };
    }
    if (msg.includes("timeout") || msg.includes("TimeoutError")) {
      return { success: false, error: `Connection timed out reaching ${body.url} — check the URL and ensure the service is running` };
    }
    return { success: false, error: msg };
  }
});

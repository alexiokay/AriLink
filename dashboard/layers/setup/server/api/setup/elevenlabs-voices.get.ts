export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  // Use provided key, or fall back to server env
  const apiKey = (query.apiKey as string) || process.env.ELEVENLABS_API_KEY || "";

  if (!apiKey) {
    return { success: false, error: "API key required", voices: [] };
  }

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { success: false, error: "Invalid API key", voices: [] };
      }
      return { success: false, error: `API error ${res.status}`, voices: [] };
    }

    const data = await res.json();
    const voices = (data.voices || []).map((v: any) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category || "unknown",
      labels: v.labels || {},
    }));

    return { success: true, voices };
  } catch (err: any) {
    return { success: false, error: err.message || String(err), voices: [] };
  }
});

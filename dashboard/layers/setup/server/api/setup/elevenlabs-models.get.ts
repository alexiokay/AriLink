export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  // Use provided key, or fall back to server env
  const apiKey = (query.apiKey as string) || process.env.ELEVENLABS_API_KEY || "";

  if (!apiKey) {
    return { success: false, error: "API key required", models: [] };
  }

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/models", {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { success: false, error: "Invalid API key", models: [] };
      }
      return { success: false, error: `API error ${res.status}`, models: [] };
    }

    const data = await res.json();
    const models = (data || [])
      .filter((m: any) => m.can_do_text_to_speech)
      .map((m: any) => ({
        id: m.model_id,
        name: m.name,
        description: m.description?.substring(0, 120) || "",
        languages: (m.languages || []).length,
      }));

    return { success: true, models };
  } catch (err: any) {
    return { success: false, error: err.message || String(err), models: [] };
  }
});

const PROVIDERS: Record<string, { url: string; path: string; model: string }> = {
  ollama: {
    url: "http://localhost:11434",
    path: "/v1/chat/completions",
    model: "llama3.2",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com",
    path: "/v1beta/openai/chat/completions",
    model: "gemini-3-flash-preview",
  },
  openai: {
    url: "https://api.openai.com",
    path: "/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  openrouter: {
    url: "https://openrouter.ai/api",
    path: "/v1/chat/completions",
    model: "anthropic/claude-sonnet-4-20250514",
  },
};

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    provider: string;
    endpoint?: string;
    model?: string;
    apiKey?: string;
  }>(event);

  if (!body.provider) {
    throw createError({ statusCode: 400, message: "Missing provider" });
  }

  // Build completions URL from provider preset
  const preset = PROVIDERS[body.provider];
  let url: string;
  let modelName: string;

  if (preset) {
    const baseUrl = (body.endpoint || preset.url).replace(/\/$/, "");
    url = baseUrl + preset.path;
    modelName = body.model || preset.model;
  } else {
    // Custom provider
    const baseUrl = (body.endpoint || "http://localhost:11434").replace(/\/$/, "");
    url = baseUrl + "/v1/chat/completions";
    modelName = body.model || "llama3.2";
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (body.apiKey) {
    headers["Authorization"] = `Bearer ${body.apiKey}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: "Say hi in one word." }],
        max_tokens: 10,
        stream: false,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      return {
        success: false,
        error: `${res.status}: ${errorText.substring(0, 150)}`,
      };
    }

    const data = (await res.json()) as any;
    const content = data.choices?.[0]?.message?.content?.trim();

    return {
      success: true,
      model: data.model || modelName,
      response: content?.substring(0, 50) || "",
    };
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes("ECONNREFUSED")) {
      return {
        success: false,
        error: `Not reachable at ${url} — make sure the LLM service is running`,
      };
    }
    if (msg.includes("timeout") || msg.includes("TimeoutError")) {
      return {
        success: false,
        error: `Connection timed out — check the URL and ensure the service is running`,
      };
    }
    return { success: false, error: msg };
  }
});

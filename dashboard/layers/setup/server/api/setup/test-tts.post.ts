export default defineEventHandler(async (event) => {
  const body = await readBody<{
    provider: string;
    wsUrl?: string;
    apiKey?: string;
    voiceId?: string;
    model?: string;
  }>(event);

  const provider = (body.provider || "kokoro").toLowerCase();

  if (provider === "elevenlabs") {
    // Use provided key, or fall back to server env (handles masked values)
    const apiKey = (body.apiKey && body.apiKey !== "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")
      ? body.apiKey
      : process.env.ELEVENLABS_API_KEY;
    const voiceId = body.voiceId || process.env.ELEVENLABS_VOICE_ID;
    const model = body.model || process.env.ELEVENLABS_MODEL;
    return testElevenLabs(apiKey, voiceId, model);
  }
  return testKokoro(body.wsUrl || process.env.TTS_SERVICE);
});

/** Build a WAV header for 16kHz 16-bit mono PCM */
function wavHeader(pcmBytes: number): Buffer {
  const buf = Buffer.alloc(44);
  const sampleRate = 16000;
  const bitsPerSample = 16;
  const channels = 1;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + pcmBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);          // chunk size
  buf.writeUInt16LE(1, 20);           // PCM format
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(pcmBytes, 40);
  return buf;
}

async function testElevenLabs(
  apiKey?: string,
  voiceId?: string,
  model?: string
): Promise<{ success: boolean; provider?: string; error?: string; latencyMs?: number; audioBase64?: string }> {
  if (!apiKey) {
    return { success: false, error: "API key is required" };
  }

  const voice = voiceId || "21m00Tcm4TlvDq8ikWAM";
  const modelId = model || "eleven_flash_v2_5";

  try {
    const start = Date.now();
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_22050_32`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "Hello, this is a voice test.",
        model_id: modelId,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      if (res.status === 401) {
        return { success: false, error: "Invalid API key" };
      }
      const errText = await res.text().catch(() => "");
      return { success: false, error: `API error ${res.status}: ${errText.substring(0, 150)}` };
    }

    const arrayBuf = await res.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuf).toString("base64");

    return {
      success: true,
      provider: `ElevenLabs (${modelId}, ${latencyMs}ms)`,
      latencyMs,
      audioBase64,
      audioMime: "audio/mpeg",
    } as any;
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes("timeout") || msg.includes("TimeoutError")) {
      return { success: false, error: "Synthesis timed out (15s)" };
    }
    return { success: false, error: msg };
  }
}

async function testKokoro(
  wsUrl?: string
): Promise<{ success: boolean; provider?: string; error?: string; latencyMs?: number; audioBase64?: string; audioMime?: string }> {
  if (!wsUrl) {
    return { success: false, error: "Service URL is required" };
  }

  try {
    const WebSocket = (await import("ws")).default;

    return await new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const start = Date.now();

      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        resolve({ success: false, error: `Connection timed out (${wsUrl})` });
      }, 10000);

      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        // Send a real synthesis request
        ws.send(JSON.stringify({
          sessionId: "test-preview",
          text: "Hello, this is a voice test.",
          voice: process.env.TTS_VOICE || "af_heart",
          speed: parseFloat(process.env.TTS_SPEED || "1.0"),
        }));
      });

      ws.on("message", (data: any) => {
        if (typeof data === "string" || (Buffer.isBuffer(data) && data[0] === 0x7b)) {
          // JSON message
          const text = typeof data === "string" ? data : data.toString();
          try {
            const msg = JSON.parse(text);
            if (msg.type === "tts_done") {
              clearTimeout(timer);
              ws.close();

              const latencyMs = Date.now() - start;
              const pcm = Buffer.concat(chunks);

              if (pcm.length === 0) {
                resolve({ success: true, provider: `Kokoro (${wsUrl}, ${latencyMs}ms)`, latencyMs });
                return;
              }

              // Wrap slin16 PCM in a WAV header so the browser can play it
              const wav = Buffer.concat([wavHeader(pcm.length), pcm]);
              const audioBase64 = wav.toString("base64");

              resolve({
                success: true,
                provider: `Kokoro (${wsUrl}, ${latencyMs}ms)`,
                latencyMs,
                audioBase64,
                audioMime: "audio/wav",
              });
            } else if (msg.type === "error") {
              clearTimeout(timer);
              ws.close();
              resolve({ success: false, error: msg.error || "Kokoro synthesis error" });
            }
          } catch {}
        } else {
          // Binary audio chunk — raw slin16 PCM
          chunks.push(Buffer.from(data));
        }
      });

      ws.on("error", (err: any) => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        const msg = err.message || String(err);
        if (msg.includes("ECONNREFUSED")) {
          resolve({ success: false, error: `Not reachable at ${wsUrl}` });
        } else {
          resolve({ success: false, error: msg });
        }
      });
    });
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

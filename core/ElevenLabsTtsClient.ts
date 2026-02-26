/**
 * ElevenLabs TTS Client for AriLink
 *
 * HTTP-based text-to-speech using ElevenLabs API.
 * Same public API as TtsClient (Kokoro) so AriControllerServer can swap providers.
 *
 * Uses output_format=pcm_16000 which returns raw 16kHz 16-bit LE PCM (slin16)
 * — no audio conversion needed.
 */

const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TTS_TEMP_DIR = path.join(os.tmpdir(), "arilink_tts");
const API_BASE = "https://api.elevenlabs.io/v1";

class ElevenLabsTtsClient extends EventEmitter {
  private apiKey: string;
  private voiceId: string;
  private modelId: string;
  private langCode: string;
  private connected: boolean = false;

  constructor(options: {
    apiKey: string;
    voiceId?: string;
    model?: string;
    langCode?: string;
  }) {
    super();
    this.apiKey = options.apiKey;
    this.voiceId = options.voiceId || "21m00Tcm4TlvDq8ikWAM"; // Rachel
    this.modelId = options.model || "eleven_flash_v2_5";
    this.langCode = options.langCode || "";

    if (!fs.existsSync(TTS_TEMP_DIR)) {
      fs.mkdirSync(TTS_TEMP_DIR, { recursive: true });
    }
  }

  /**
   * Validate API key by calling GET /v1/voices.
   */
  connect(): void {
    if (this.connected) return;

    console.log("[TTS] Connecting to ElevenLabs API...");

    fetch(`${API_BASE}/voices`, {
      headers: { "xi-api-key": this.apiKey },
      signal: AbortSignal.timeout(10000),
    })
      .then((res) => {
        if (res.ok) {
          this.connected = true;
          console.log("[TTS] ElevenLabs API key validated");
          this.emit("connected");
        } else {
          console.error(`[TTS] ElevenLabs API key invalid: ${res.status}`);
          this.emit("error", new Error(`API key invalid (${res.status})`));
          this.emit("disconnected");
        }
      })
      .catch((err: any) => {
        console.error(`[TTS] ElevenLabs connection failed: ${err.message}`);
        this.emit("error", err);
        this.emit("disconnected");
      });
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Synthesize text to a temporary slin16 audio file.
   * Returns the absolute file path for Asterisk playback.
   */
  async synthesize(
    sessionId: string,
    text: string,
    _voice?: string,
    _speed?: number
  ): Promise<string> {
    const pcm = await this.callApi(text);

    const filePath = path.join(
      TTS_TEMP_DIR,
      `tts_${sessionId}_${Date.now()}.sln16`
    );
    fs.writeFileSync(filePath, pcm);
    console.log(
      `[TTS] ElevenLabs: ${pcm.length} bytes → ${filePath}`
    );
    return filePath;
  }

  /**
   * Synthesize text to a raw slin16 PCM buffer (no file I/O).
   * Used for Rust RTP injection path.
   */
  async synthesizeToBuffer(
    sessionId: string,
    text: string,
    _voice?: string,
    _speed?: number
  ): Promise<Buffer> {
    const pcm = await this.callApi(text);
    console.log(
      `[TTS] ElevenLabs: ${pcm.length} bytes (buffer mode)`
    );
    return pcm;
  }

  /**
   * Call ElevenLabs TTS API and return raw PCM audio.
   */
  private async callApi(text: string): Promise<Buffer> {
    if (!this.connected) {
      throw new Error("ElevenLabs TTS not connected");
    }

    const url = `${API_BASE}/text-to-speech/${this.voiceId}/stream?output_format=pcm_16000`;

    const body: any = {
      text,
      model_id: this.modelId,
    };

    // Add language code if set (ISO 639-1, e.g. "pl", "de", "en")
    if (this.langCode) {
      body.language_code = this.langCode;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `ElevenLabs API error ${res.status}: ${errText.substring(0, 200)}`
      );
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  static cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err: any) {
      console.error(`[TTS] Failed to clean up ${filePath}: ${err.message}`);
    }
  }

  close(): void {
    this.connected = false;
  }
}

module.exports.ElevenLabsTtsClient = ElevenLabsTtsClient;
export {};

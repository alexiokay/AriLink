/**
 * TTS Client for AriLink
 *
 * WebSocket client that connects to a Kokoro TTS service and synthesizes
 * text into slin16 PCM audio (16kHz, 16-bit signed LE) for Asterisk playback.
 *
 * Protocol (matches tts-services/kokoro-service/server.py):
 *   Send:    JSON  {"sessionId": "abc", "text": "Hello", "voice": "af_heart", "speed": 1.0}
 *   Receive: binary slin16 PCM chunks
 *   Receive: JSON  {"type": "tts_done", "sessionId": "abc", "durationMs": 1234}
 */

const EventEmitter = require("events");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Directory for temp TTS audio files that Asterisk will play
const TTS_TEMP_DIR = path.join(os.tmpdir(), "arilink_tts");

class TtsClient extends EventEmitter {
  private wsUrl: string;
  private ws: any;
  private connected: boolean = false;
  private reconnectTimer: any = null;
  private defaultVoice: string;
  private defaultSpeed: number;

  // Pending synthesis requests: sessionId -> { resolve, reject, chunks, timer }
  private pending: Map<
    string,
    {
      resolve: (filePath: string) => void;
      reject: (err: Error) => void;
      chunks: Buffer[];
      timer: any;
    }
  > = new Map();

  constructor(wsUrl: string, options?: { voice?: string; speed?: number }) {
    super();
    this.wsUrl = wsUrl;
    this.defaultVoice = options?.voice || process.env.TTS_VOICE || "af_heart";
    this.defaultSpeed = options?.speed || parseFloat(process.env.TTS_SPEED || "1.0");

    // Ensure temp directory exists
    if (!fs.existsSync(TTS_TEMP_DIR)) {
      fs.mkdirSync(TTS_TEMP_DIR, { recursive: true });
    }
  }

  connect(): void {
    if (this.connected || this.ws) return;

    console.log(`[TTS] Connecting to: ${this.wsUrl}`);

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (err: any) {
      console.error(`[TTS] Failed to create WebSocket: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on("error", (err: any) => {
      console.error(`[TTS] WebSocket error: ${err.message || err}`);
      this.emit("error", err);
    });

    this.ws.on("open", () => {
      console.log("[TTS] Connected to Kokoro TTS service");
      this.connected = true;
      this.emit("connected");
    });

    this.ws.on("message", (data: any) => {
      if (typeof data === "string" || (Buffer.isBuffer(data) && data[0] === 0x7b)) {
        // JSON message
        const text = typeof data === "string" ? data : data.toString();
        try {
          const msg = JSON.parse(text);
          this.handleJsonMessage(msg);
        } catch {
          console.error("[TTS] Invalid JSON from server:", text.substring(0, 100));
        }
      } else {
        // Binary audio chunk — raw slin16 PCM
        this.handleAudioChunk(data);
      }
    });

    this.ws.on("close", () => {
      console.log("[TTS] Disconnected from Kokoro TTS service");
      this.connected = false;
      this.ws = null;
      this.emit("disconnected");
      this.scheduleReconnect();
    });
  }

  private handleJsonMessage(msg: any): void {
    if (msg.type === "tts_done") {
      const entry = this.pending.get(msg.sessionId);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.sessionId);

        // Concatenate all audio chunks and write to temp file
        const allAudio = Buffer.concat(entry.chunks);
        const filePath = path.join(
          TTS_TEMP_DIR,
          `tts_${msg.sessionId}_${Date.now()}.sln16`
        );

        try {
          fs.writeFileSync(filePath, allAudio);
          console.log(
            `[TTS] Saved ${allAudio.length} bytes → ${filePath} (${msg.durationMs || "?"}ms audio)`
          );
          entry.resolve(filePath);
        } catch (err: any) {
          entry.reject(new Error(`Failed to write TTS audio: ${err.message}`));
        }
      }
    } else if (msg.type === "error") {
      const entry = this.pending.get(msg.sessionId);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.sessionId);
        entry.reject(new Error(msg.error || "TTS synthesis failed"));
      }
      console.error(`[TTS] Error for ${msg.sessionId}: ${msg.error}`);
    }
  }

  private handleAudioChunk(data: Buffer): void {
    // Binary chunks don't have session ID tagging in the simple protocol —
    // we only support one synthesis at a time per WebSocket connection.
    // For concurrent sessions, we'd need session multiplexing.
    //
    // Find the first pending entry and append the chunk to it.
    // In practice, synthesize() is called sequentially per session.
    for (const [, entry] of this.pending) {
      entry.chunks.push(Buffer.from(data));
      return;
    }
  }

  /**
   * Synthesize text to a temporary slin16 audio file.
   * Returns the absolute file path (without extension) for Asterisk `sound:` playback.
   *
   * @param sessionId - Call session ID
   * @param text - Text to synthesize
   * @param voice - Voice name (default: af_heart)
   * @param speed - Speech speed (default: 1.0)
   * @returns Absolute path to the slin16 file (without .sln16 extension for Asterisk)
   */
  synthesize(
    sessionId: string,
    text: string,
    voice?: string,
    speed?: number
  ): Promise<string> {
    return new Promise((promiseResolve, promiseReject) => {
      if (!this.connected || !this.ws) {
        promiseReject(new Error("TTS service not connected"));
        return;
      }

      // Timeout: 15 seconds max per synthesis
      const timer = setTimeout(() => {
        this.pending.delete(sessionId);
        promiseReject(new Error("TTS synthesis timeout (15s)"));
      }, 15000);

      this.pending.set(sessionId, {
        resolve: promiseResolve,
        reject: promiseReject,
        chunks: [],
        timer,
      });

      const request = {
        sessionId,
        text,
        voice: voice || this.defaultVoice,
        speed: speed || this.defaultSpeed,
      };

      try {
        this.ws.send(JSON.stringify(request));
      } catch (err: any) {
        clearTimeout(timer);
        this.pending.delete(sessionId);
        promiseReject(new Error(`Failed to send TTS request: ${err.message}`));
      }
    });
  }

  /**
   * Clean up a temporary TTS audio file after playback.
   */
  static cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err: any) {
      console.error(`[TTS] Failed to clean up ${filePath}: ${err.message}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log("[TTS] Scheduling reconnect in 5s...");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending requests
    for (const [sessionId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("TTS client closed"));
    }
    this.pending.clear();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.connected = false;
  }
}

module.exports.TtsClient = TtsClient;
export {};

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
 *
 * Requests are serialized: only one synthesis is in-flight at a time.
 * The Kokoro server processes requests sequentially per connection, so
 * binary chunks always belong to the single active request.
 */

const EventEmitter = require("events");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Directory for temp TTS audio files that Asterisk will play
const TTS_TEMP_DIR = path.join(os.tmpdir(), "arilink_tts");

interface PendingEntry {
  resolve: (result: any) => void;
  reject: (err: Error) => void;
  chunks: Buffer[];
  timer: any;
  bufferMode: boolean;
}

interface QueuedRequest {
  sessionId: string;
  text: string;
  voice: string;
  speed: number;
  resolve: (result: any) => void;
  reject: (err: Error) => void;
  bufferMode: boolean;
}

class TtsClient extends EventEmitter {
  private wsUrl: string;
  private ws: any;
  private connected: boolean = false;
  private reconnectTimer: any = null;
  private reconnectDelay: number = 5000; // exponential backoff: 5s → 10s → 20s → 30s max
  private failCount: number = 0;
  private defaultVoice: string;
  private defaultSpeed: number;

  // The single in-flight synthesis request
  private active: PendingEntry | null = null;
  private activeSessionId: string | null = null;

  // Queue of requests waiting to be sent
  private queue: QueuedRequest[] = [];

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

    // Only log the first attempt and successful reconnects (suppress retry spam)
    if (this.failCount === 0) {
      console.log(`[TTS] Connecting to: ${this.wsUrl}`);
    }

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (err: any) {
      if (this.failCount === 0) {
        console.error(`[TTS] Failed to create WebSocket: ${err.message}`);
      }
      this.failCount++;
      this.scheduleReconnect();
      return;
    }

    this.ws.on("error", (err: any) => {
      // Only log the first error, then go quiet to avoid console spam
      if (this.failCount === 0) {
        console.error(`[TTS] WebSocket error: ${err.message || err}`);
      }
      this.emit("error", err);
    });

    this.ws.on("open", () => {
      // Reset backoff on successful connection
      if (this.failCount > 0) {
        console.log(`[TTS] Connected to Kokoro TTS service (after ${this.failCount} retries)`);
      } else {
        console.log("[TTS] Connected to Kokoro TTS service");
      }
      this.failCount = 0;
      this.reconnectDelay = 5000;
      this.connected = true;
      this.emit("connected");

      // Process any queued requests
      this.drainQueue();
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
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      if (wasConnected) {
        console.log("[TTS] Disconnected from Kokoro TTS service");
      }
      this.failCount++;
      this.emit("disconnected");

      // Reject the active request on disconnect
      if (this.active) {
        clearTimeout(this.active.timer);
        this.active.reject(new Error("TTS service disconnected"));
        this.active = null;
        this.activeSessionId = null;
      }

      this.scheduleReconnect();
    });
  }

  private handleJsonMessage(msg: any): void {
    if (msg.type === "tts_done") {
      if (!this.active || this.activeSessionId !== msg.sessionId) return;

      const entry = this.active;
      clearTimeout(entry.timer);
      this.active = null;
      this.activeSessionId = null;

      const allAudio = Buffer.concat(entry.chunks);

      if (entry.bufferMode) {
        // Return raw PCM buffer directly (for Rust AEC path)
        console.log(
          `[TTS] Synthesized ${allAudio.length} bytes (${msg.durationMs || "?"}ms audio)`
        );
        entry.resolve(allAudio);
      } else {
        // Write to temp file (for channel.play() path)
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

      // Send next queued request
      this.drainQueue();
    } else if (msg.type === "error") {
      if (this.active && this.activeSessionId === msg.sessionId) {
        clearTimeout(this.active.timer);
        const entry = this.active;
        this.active = null;
        this.activeSessionId = null;
        entry.reject(new Error(msg.error || "TTS synthesis failed"));
        this.drainQueue();
      }
      console.error(`[TTS] Error for ${msg.sessionId}: ${msg.error}`);
    }
  }

  private handleAudioChunk(data: Buffer): void {
    // Route binary chunk to the single active request
    if (this.active) {
      this.active.chunks.push(Buffer.from(data));
    }
  }

  /**
   * Send the next queued request if nothing is in-flight.
   */
  private drainQueue(): void {
    if (this.active || this.queue.length === 0) return;
    if (!this.connected || !this.ws) return;

    const req = this.queue.shift()!;
    this.activeSessionId = req.sessionId;

    const timer = setTimeout(() => {
      this.active = null;
      this.activeSessionId = null;
      req.reject(new Error("TTS synthesis timeout (15s)"));
      this.drainQueue();
    }, 15000);

    this.active = {
      resolve: req.resolve,
      reject: req.reject,
      chunks: [],
      timer,
      bufferMode: req.bufferMode,
    };

    const request = {
      sessionId: req.sessionId,
      text: req.text,
      voice: req.voice || this.defaultVoice,
      speed: req.speed ?? this.defaultSpeed,
    };

    try {
      this.ws.send(JSON.stringify(request));
    } catch (err: any) {
      clearTimeout(timer);
      this.active = null;
      this.activeSessionId = null;
      req.reject(new Error(`Failed to send TTS request: ${err.message}`));
      this.drainQueue();
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
   * @returns Absolute path to the sln16 file (without .sln16 extension for Asterisk)
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

      this.queue.push({
        sessionId,
        text,
        voice: voice || this.defaultVoice,
        speed: speed ?? this.defaultSpeed,
        resolve: promiseResolve,
        reject: promiseReject,
        bufferMode: false,
      });

      this.drainQueue();
    });
  }

  /**
   * Synthesize text to a raw slin16 PCM buffer (no file I/O).
   * Used when sending TTS audio to the Rust RTP server for injection via AEC path.
   */
  synthesizeToBuffer(
    sessionId: string,
    text: string,
    voice?: string,
    speed?: number
  ): Promise<Buffer> {
    return new Promise((promiseResolve, promiseReject) => {
      if (!this.connected || !this.ws) {
        promiseReject(new Error("TTS service not connected"));
        return;
      }

      this.queue.push({
        sessionId,
        text,
        voice: voice || this.defaultVoice,
        speed: speed ?? this.defaultSpeed,
        resolve: promiseResolve,
        reject: promiseReject,
        bufferMode: true,
      });

      this.drainQueue();
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    // Exponential backoff: 5s → 10s → 20s → 30s max
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject the active request
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.reject(new Error("TTS client closed"));
      this.active = null;
      this.activeSessionId = null;
    }

    // Reject all queued requests
    for (const req of this.queue) {
      req.reject(new Error("TTS client closed"));
    }
    this.queue.length = 0;

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

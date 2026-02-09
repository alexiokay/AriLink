import * as WS from "ws";
import { EventEmitter } from "events";

const WebSocket = WS.WebSocket || WS;

interface TranscriptionConfig {
  encoding: string;
  sampleRateHertz: number;
  languageCode: string;
  audioChannelCount: number;
}

/**
 * Transcription Provider
 * Connects to transcription service (Parakeet, Whisper, etc.) via WebSocket
 * Supports automatic fallback to backup services
 */
class TranscriptionProvider extends EventEmitter {
  private config: TranscriptionConfig;
  private audioServer: any;
  private transcriptCallback: (text: string, isFinal: boolean) => void;
  private ws: any;
  private serviceUrl: string;
  private fallbackServices: string[];
  private currentServiceIndex: number = 0;
  private allServices: string[];
  private reconnectInterval: number = 5000;
  private reconnectTimer: any;
  private isConnecting: boolean = false;
  private audioBuffer: Buffer[] = [];
  private bufferFlushInterval: any;
  private maxReconnectAttempts: number = 3;
  private reconnectAttempts: number = 0;

  constructor(
    config: TranscriptionConfig,
    audioServer: any,
    transcriptCallback: (text: string, isFinal: boolean) => void,
    serviceUrl: string,
    fallbackServices: string[] = []
  ) {
    super();
    this.config = config;
    this.audioServer = audioServer;
    this.transcriptCallback = transcriptCallback;
    this.fallbackServices = fallbackServices;
    this.allServices = [serviceUrl, ...fallbackServices].filter(s => s.toLowerCase() !== "google");
    this.serviceUrl = this.allServices[0];

    console.log(
      `[TranscriptionProvider] Connecting to transcription service at ${this.serviceUrl}`
    );
    if (this.allServices.length > 1) {
      console.log(`[TranscriptionProvider] Fallback services available: ${this.allServices.slice(1).join(", ")}`);
    }

    // Connect to transcription service
    this.connect();

    // Listen for audio data from the RTP server
    console.log("[TranscriptionProvider] Setting up audio listener...");
    this.audioServer.on("data", (audioChunk: Buffer) => {
      console.log(`[TranscriptionProvider] Received audio chunk: ${audioChunk.length} bytes`);
      this.handleAudioData(audioChunk);
    });

    // Flush audio buffer periodically (every 100ms)
    // Near-instant response for real-time conversations
    this.bufferFlushInterval = setInterval(() => {
      this.flushAudioBuffer();
    }, 100);  // 100ms for low latency
  }

  private connect(): void {
    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.serviceUrl);

      this.ws.on("open", () => {
        console.log(`[TranscriptionProvider] ✅ Connected to transcription service: ${this.serviceUrl}`);
        this.isConnecting = false;
        this.reconnectAttempts = 0; // Reset on successful connection

        // Clear reconnect timer if exists
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // Send a ping to verify connection
        this.ws.send(JSON.stringify({ type: "ping" }));
      });

      this.ws.on("message", (data: any) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === "transcription") {
            const text = message.text;
            const isFinal = message.is_final || true;

            if (text && text.trim().length > 0) {
              console.log(`[TranscriptionProvider] Transcription: ${text}`);
              this.transcriptCallback(text, isFinal);
            }
          } else if (message.type === "pong") {
            console.log("[TranscriptionProvider] Received pong from service");
          }
        } catch (err) {
          console.error("[TranscriptionProvider] Error parsing message:", err);
        }
      });

      this.ws.on("error", (error: Error) => {
        console.error("[TranscriptionProvider] WebSocket error:", error.message);
        this.isConnecting = false;
        this.reconnectAttempts++;
      });

      this.ws.on("close", () => {
        console.log("[TranscriptionProvider] ⚠️ Connection to transcription service closed");
        this.isConnecting = false;
        this.reconnectAttempts++;

        // If we've failed too many times, try fallback service
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          if (this.currentServiceIndex + 1 < this.allServices.length) {
            this.currentServiceIndex++;
            this.serviceUrl = this.allServices[this.currentServiceIndex];
            this.reconnectAttempts = 0;
            console.log(
              `[TranscriptionProvider] ⚠️ Max reconnect attempts reached, switching to fallback: ${this.serviceUrl}`
            );
            this.reconnectTimer = setTimeout(() => {
              this.connect();
            }, 1000);
          } else {
            console.error(
              "[TranscriptionProvider] ❌ All transcription services failed!"
            );
            // Reset to start and try again
            this.currentServiceIndex = 0;
            this.serviceUrl = this.allServices[0];
            this.reconnectAttempts = 0;
            this.reconnectTimer = setTimeout(() => {
              this.connect();
            }, this.reconnectInterval);
          }
        } else {
          // Attempt to reconnect to current service
          console.log(
            `[TranscriptionProvider] Reconnecting to ${this.serviceUrl} in ${
              this.reconnectInterval / 1000
            } seconds... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
          );
          this.reconnectTimer = setTimeout(() => {
            this.connect();
          }, this.reconnectInterval);
        }
      });
    } catch (err) {
      console.error("[TranscriptionProvider] Failed to connect:", err);
      this.isConnecting = false;
      this.reconnectAttempts++;

      // Retry connection with fallback logic
      if (this.reconnectAttempts >= this.maxReconnectAttempts && this.currentServiceIndex + 1 < this.allServices.length) {
        this.currentServiceIndex++;
        this.serviceUrl = this.allServices[this.currentServiceIndex];
        this.reconnectAttempts = 0;
        console.log(
          `[TranscriptionProvider] Switching to fallback: ${this.serviceUrl}`
        );
      }

      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, this.reconnectInterval);
    }
  }

  private handleAudioData(audioChunk: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Buffer audio until connection is established
      return;
    }

    // Convert audio if needed
    const processedAudio = this.convertAudioFormat(audioChunk);

    // Add to buffer
    this.audioBuffer.push(processedAudio);
  }

  private convertAudioFormat(audioChunk: Buffer): Buffer {
    // If audio is already in the correct format (LINEAR16 at 16kHz), return as-is
    if (
      this.config.encoding === "LINEAR16" &&
      this.config.sampleRateHertz === 16000
    ) {
      return audioChunk;
    }

    // If audio is MULAW (8kHz), we need to:
    // 1. Decode MULAW to PCM
    // 2. Resample from 8kHz to 16kHz
    // For now, we'll pass it through and handle resampling in the transcription service if needed
    // TODO: Implement proper MULAW decoding and resampling

    return audioChunk;
  }

  private flushAudioBuffer(): void {
    if (this.audioBuffer.length === 0) {
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log(
        "[TranscriptionProvider] Cannot send audio - WebSocket not connected"
      );
      return;
    }

    try {
      // Concatenate all buffered audio
      const combinedAudio = Buffer.concat(this.audioBuffer);

      console.log(`[TranscriptionProvider] Sending ${combinedAudio.length} bytes to transcription service`);

      // Send to transcription service
      this.ws.send(combinedAudio);

      // Clear buffer
      this.audioBuffer = [];
    } catch (err) {
      console.error("[TranscriptionProvider] Error sending audio:", err);
    }
  }

  public close(): void {
    console.log("[TranscriptionProvider] Closing provider");

    // Clear intervals
    if (this.bufferFlushInterval) {
      clearInterval(this.bufferFlushInterval);
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Flush remaining audio
    this.flushAudioBuffer();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports.TranscriptionProvider = TranscriptionProvider;

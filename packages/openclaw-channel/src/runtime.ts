/**
 * AriLink runtime — manages the Socket.IO connection to the AriLink server.
 *
 * The connection is lazy: it's established when the gateway starts
 * and torn down when it stops.
 */

import { io, type Socket } from "socket.io-client";

let _runtime: any = null;
let _socket: Socket | null = null;
let _config: AriLinkConfig | null = null;

export interface AriLinkConfig {
  arilinkUrl: string;
  autoAnswer: boolean;
  greeting: string;
  ttsProvider: "asterisk" | "elevenlabs" | "openai";
  ttsVoice: string;
  silenceTimeoutMs: number;
  maxCallDurationMs: number;
}

const DEFAULTS: AriLinkConfig = {
  arilinkUrl: "http://localhost:3011",
  autoAnswer: true,
  greeting: "Hello, how can I help you today?",
  ttsProvider: "asterisk",
  ttsVoice: "",
  silenceTimeoutMs: 30000,
  maxCallDurationMs: 600000,
};

export function setRuntime(runtime: any): void {
  _runtime = runtime;
}

export function getRuntime(): any {
  return _runtime;
}

export function getAriLinkSocket(): Socket | null {
  return _socket;
}

export function getConfig(): AriLinkConfig {
  return _config ?? DEFAULTS;
}

/**
 * Resolve AriLink config from OpenClaw's config object.
 * Reads from `channels.arilink` section.
 */
export function resolveConfig(cfg: any): AriLinkConfig {
  const raw = cfg?.channels?.arilink ?? {};
  return {
    arilinkUrl: raw.arilinkUrl ?? DEFAULTS.arilinkUrl,
    autoAnswer: raw.autoAnswer ?? DEFAULTS.autoAnswer,
    greeting: raw.greeting ?? DEFAULTS.greeting,
    ttsProvider: raw.ttsProvider ?? DEFAULTS.ttsProvider,
    ttsVoice: raw.ttsVoice ?? DEFAULTS.ttsVoice,
    silenceTimeoutMs: raw.silenceTimeoutMs ?? DEFAULTS.silenceTimeoutMs,
    maxCallDurationMs: raw.maxCallDurationMs ?? DEFAULTS.maxCallDurationMs,
  };
}

/**
 * Connect to AriLink via Socket.IO.
 * Returns the socket instance. Reconnects automatically on disconnect.
 */
export function connect(config: AriLinkConfig): Socket {
  if (_socket?.connected) return _socket;

  _config = config;

  _socket = io(config.arilinkUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 10000,
  });

  _socket.on("connect", () => {
    console.log(`[AriLink] Connected to ${config.arilinkUrl}`);
    // Register as OpenClaw consumer
    _socket!.emit("openclaw:register", {
      autoAnswer: config.autoAnswer,
      greeting: config.greeting,
      ttsProvider: config.ttsProvider,
      ttsVoice: config.ttsVoice,
      silenceTimeoutMs: config.silenceTimeoutMs,
      maxCallDurationMs: config.maxCallDurationMs,
    });
  });

  _socket.on("disconnect", (reason) => {
    console.log(`[AriLink] Disconnected: ${reason}`);
  });

  _socket.on("connect_error", (err) => {
    console.error(`[AriLink] Connection error: ${err.message}`);
  });

  return _socket;
}

/**
 * Disconnect from AriLink.
 */
export function disconnect(): void {
  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
    _socket = null;
  }
  _config = null;
}

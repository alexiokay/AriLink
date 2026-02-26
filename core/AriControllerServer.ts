const util = require("util");
const ari = require("ari-client");
const EventEmitter = require("events");
const WebSocket = require("ws");
const moment = require("moment");

const path = require("path");

const {
  CallSessionManager,
  sessionManager,
} = require("./CallSession");
const { AssistantFactory } = require("./AssistantFactory");
const { TtsClient } = require("./TtsClient");
const { ElevenLabsTtsClient } = require("./ElevenLabsTtsClient");
const fs = require("fs");
const { execFileSync, execFile } = require("child_process");

// Type definition for CallSessionData (inline since we can't import types with require)
interface CallSessionData {
  id: string;
  bridge: any;
  incomingChannel: any;
  outgoingChannel?: any;
  externalMediaChannelId?: string;
  externalMediaOutChannelId?: string;
  assistant?: any;
  callerName?: string;
  startTime: Date;
  status: "pending" | "active" | "ended";
  noMatchCount: number;
}

interface SpeakQueueItem {
  text: string;
  channel: any;
  assistant?: any;
  queuedAtMs: number;
}

interface SessionSpeechState {
  queue: SpeakQueueItem[];
  processingQueue: boolean;
  ttsActive: boolean;
  suppressTranscriptionUntilMs: number;
  lastSpokenNormalized: string;
  lastSpokenAtMs: number;
  /** Ring buffer of recently spoken texts for textual echo cancellation */
  recentSpokenTexts: { normalized: string; atMs: number }[];
  /** Timestamp when the current speaking queue started (for dynamic cooldown) */
  queueStartedAtMs: number;
  /** Barge-in: ARI playback object for current channel.play() (legacy path) */
  currentPlayback?: any;
  /** Barge-in: current sound file name for cleanup on cancel */
  currentSoundName?: string;
  /** Barge-in: current Rust utterance ID */
  currentUtteranceId?: string;
  /** Barge-in: ARI channel reference for unmute on cancel */
  currentChannel?: any;
  /** Barge-in enabled for this session */
  bargeInEnabled: boolean;
  /** Barge-in was triggered — signals processSpeakQueue to stop */
  bargeInTriggered: boolean;
  /** Two-stage barge-in: audio was stopped by energy detection, awaiting text confirmation */
  awaitingBargeInText: boolean;
  /** Post-barge-in echo suppression window: TEC-check all transcriptions until this timestamp */
  postBargeInSuppressionUntilMs: number;
  /** TTS prefetch: pre-synthesized buffer for the next queued sentence */
  prefetchedTtsBuffer?: Buffer;
  prefetchedTtsText?: string;
}

class AriControllerServer extends EventEmitter {
  private pbxIP: string;
  private client: any;
  private ws: any;
  private contacts: any;
  private sessionManager: InstanceType<typeof CallSessionManager>;
  private useRustRtp: boolean;
  private rustServerUrl: string | undefined;
  private dashboard: any;
  private callHistory: any;
  private ttsClient: any;

  // Map to store per-session WebSocket message handlers
  private sessionMessageHandlers: Map<string, (message: any) => void> =
    new Map();
  private sessionSpeechState: Map<string, SessionSpeechState> = new Map();
  // TTS playback completion listeners (for AEC/Rust TTS path)
  private ttsPlaybackListeners: Map<string, { resolve: () => void; timer: any }> =
    new Map();
  // Dynamic cooldown: scales with how long the bot was speaking.
  // Short utterance ("OK") → ~800ms, long paragraph → up to 2000ms.
  // TEC (textual echo cancellation) handles the longer tail, so the
  // cooldown only needs to cover the STT pipeline's first-result latency.
  private cooldownBaseMs: number = parseInt(
    process.env.TRANSCRIPTION_COOLDOWN_BASE_MS || "800",
    10
  );
  private cooldownMaxMs: number = parseInt(
    process.env.TRANSCRIPTION_COOLDOWN_MAX_MS || "2000",
    10
  );
  private ttsDuplicateWindowMs: number = parseInt(
    process.env.TTS_DEDUPE_WINDOW_MS || "1500",
    10
  );
  private allowUntaggedTranscriptBroadcast: boolean =
    process.env.ALLOW_UNTAGGED_TRANSCRIPT_BROADCAST === "true";

  constructor(
    pbxIP: string,
    rustServerUrl?: string,
    deps?: { dashboard?: any; callHistory?: any }
  ) {
    super();
    this.pbxIP = pbxIP;
    this.client = null;

    this.useRustRtp = !!rustServerUrl;
    this.rustServerUrl = rustServerUrl;

    // Injected dependencies (from Nitro bootstrap plugin)
    this.dashboard = deps?.dashboard || null;
    this.callHistory = deps?.callHistory || null;
    this.ttsClient = null;

    // Use the session manager for multi-call support
    this.sessionManager = sessionManager;
  }

  async start(contacts: any[]) {
    // Connect to transcription/RTP WebSocket
    this.connectTranscriptionWS();

    // Connect to TTS service (Kokoro)
    this.connectTTS();

    this.contacts = contacts;

    if (this.contacts) {
      console.log("Contact hash map:", this.contacts);
    } else {
      console.log("Failed to convert JSON file to hash map");
    }

    // Connect to Asterisk ARI
    await this.connectARI();
    if (this.dashboard) {
      this.dashboard.updateServiceStatus("asterisk", "connected", this.pbxIP);
    }

    this.startARILoop();
  }

  async connectARI(): Promise<void> {
    if (!this.pbxIP) {
      throw new Error("PBX_IP not configured — cannot connect to ARI");
    }

    return new Promise((resolve, reject) => {
      const ariEndpoint = `http://${this.pbxIP}:8088`;
      console.log(`[Controller] Connecting to ARI: ${ariEndpoint}`);

      ari.connect(
        ariEndpoint,
        process.env.ASTERISK_LOGIN,
        process.env.ASTERISK_PASSWORD,
        (err: any, client: any) => {
          if (err) {
            const errMsg = typeof err === "string" ? err : (err.message || String(err));
            if (this.dashboard) {
              this.dashboard.updateServiceStatus("asterisk", "error", errMsg);
            }
            reject(new Error(errMsg));
          } else {
            this.client = client;
            // Prevent unhandled 'error' events on the ARI client WebSocket
            if (client._ws) {
              client._ws.on("error", (wsErr: any) => {
                console.error(`[Controller] ARI WebSocket error: ${wsErr.message || wsErr}`);
              });
              client._ws.on("close", () => {
                console.error("[Controller] ARI WebSocket closed unexpectedly");
                if (this.dashboard) {
                  this.dashboard.updateServiceStatus("asterisk", "disconnected", "Connection lost");
                }
                this.scheduleARIReconnect();
              });
            }
            resolve();
          }
        }
      );
    });
  }

  /**
   * Create a new bridge for a specific call session
   */
  async createBridgeForSession(sessionId: string): Promise<any> {
    try {
      const bridge = await this.client.bridges.create({ type: "mixing,proxy_media" });
      console.log(
        `[Session ${sessionId}] Created dedicated bridge ${bridge.id}`
      );

      bridge.on("BridgeDestroyed", (event: any) => {
        console.log(`[Session ${sessionId}] Bridge ${bridge.id} destroyed`);
        this.emit("bridgeDestroyed", event);
      });

      return bridge;
    } catch (err) {
      console.error(`[Session ${sessionId}] Error creating bridge:`, err);
      throw err;
    }
  }

  startARILoop() {
    // Defensive cleanup: remove existing listeners before re-registering
    // (prevents stacking if the same client object is reused after reconnect)
    this.client.removeAllListeners("StasisStart");
    this.client.removeAllListeners("StasisEnd");
    this.client.removeAllListeners("ChannelDtmfReceived");

    this.client.on("StasisStart", this.stasisStart.bind(this));
    this.client.on("StasisEnd", this.stasisEnd.bind(this));
    this.client.on("ChannelDtmfReceived", this.dtmfReceived.bind(this));

    const appName = process.env.STASIS_APP_NAME || "stasis-app";
    console.log(`Starting ARI application: ${appName}`);
    this.client.start(appName);
  }

  connectTranscriptionWS() {
    // Close existing connection to prevent duplicate message handlers.
    // Multiple callers (start(), dashboard reconnect, auto-reconnect) can trigger this.
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch { }
      this.ws = null;
    }
    // Cancel any pending auto-reconnect
    if (this.transcriptionReconnectTimer) {
      clearTimeout(this.transcriptionReconnectTimer);
      this.transcriptionReconnectTimer = null;
    }

    // Connect to either Rust RTP server or direct transcription WebSocket
    let wsUrl: string;
    if (this.useRustRtp) {
      wsUrl = `${this.rustServerUrl!.replace(/^http/, "ws")}/ws`;
    } else {
      // Use the first ws:// entry from TRANSCRIPTION_SERVICES
      const raw = (process.env.TRANSCRIPTION_SERVICES || "").split(",").map(s => s.trim()).find(s => s.startsWith("ws://"));
      if (!raw) {
        console.error("[Controller] No ws:// transcription service configured and Rust RTP not enabled");
        if (this.dashboard) {
          this.dashboard.updateServiceStatus("transcription", "error", "No transcription service configured");
        }
        return;
      }
      wsUrl = raw;
    }

    console.log(`[Controller] Connecting WebSocket to: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err: any) {
      console.error(`[Controller] Failed to create WebSocket: ${err.message}`);
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("transcription", "error", "Connection failed");
      }
      return;
    }

    // IMPORTANT: Register 'error' handler via EventEmitter to prevent
    // unhandled 'error' events from crashing Node.js
    this.ws.on("error", (err: any) => {
      console.error(`[Controller] WebSocket error: ${err.message || err}`);
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("transcription", "error", "Connection failed");
      }
    });

    this.ws.on("open", () => {
      console.log(`WebSocket connection established (${this.useRustRtp ? "Rust RTP" : "Node.js transcriber"})`);
      if (this.dashboard) {
        if (this.useRustRtp) {
          this.dashboard.updateServiceStatus("rustRtp", "connected", this.rustServerUrl);
          this.dashboard.updateServiceStatus("transcription", "connected", process.env.TRANSCRIPTION_SERVICES || "via Rust");
        } else {
          this.dashboard.updateServiceStatus("transcription", "connected", wsUrl);
        }
      }
    });

    // Central message router - routes transcriptions to the correct session handler
    this.ws.on("message", (data: any) => {
      const raw = typeof data === "string" ? data : data.toString();
      console.log("Received transcription:", raw);

      // Parse message; ignore unstructured payloads to avoid cross-session leaks.
      let parsedMessage: any;
      try {
        parsedMessage = JSON.parse(raw);
      } catch {
        console.warn("[Controller] Ignoring non-JSON transcription payload");
        return;
      }

      // Handle TTS playback events from Rust (AEC path)
      const msgType = parsedMessage.type;
      if (msgType === "tts_playback_done" || msgType === "tts_playback_cancelled") {
        const eventSessionId = parsedMessage.sessionId;
        const utteranceId = parsedMessage.utteranceId;
        const key = `${eventSessionId}:${utteranceId}`;
        const listener = this.ttsPlaybackListeners.get(key);
        if (listener) {
          clearTimeout(listener.timer);
          this.ttsPlaybackListeners.delete(key);
          listener.resolve();
        }
        console.log(`[Session ${eventSessionId}] ${msgType}: ${utteranceId}`);
        return;
      }

      // VAD speech_started from Parakeet/Rust — forward to assistant for turn endpointing.
      // Barge-in is handled separately by user_speaking (below), but the assistant
      // needs speech_started to know the user resumed speaking mid-turn (prevents
      // splitting "I need uh... something from shop" into two separate turns).
      if (msgType === "speech_started") {
        const sid = parsedMessage.sessionId;
        if (sid) {
          const assistant = this.sessionManager.getAssistant(sid);
          if (assistant) {
            assistant.onTranscription("", false);
          }
        }
        return;
      }

      // user_speaking: energy-based detection from Rust AEC thread (post-echo-cancelled audio).
      // This fires when real user speech is detected during TTS playback.
      // Stage 1 of two-stage barge-in: stop audio IMMEDIATELY, then wait for text confirmation.
      if (msgType === "user_speaking") {
        const eventSessionId = parsedMessage.sessionId;
        const speechState = this.getSessionSpeechState(eventSessionId);
        if (speechState.bargeInEnabled && speechState.ttsActive && !speechState.awaitingBargeInText) {
          console.log(`[Session ${eventSessionId}] BARGE-IN Stage 1: user_speaking (rms=${parsedMessage.rms?.toFixed(0)})`);
          this.cancelCurrentPlayback(eventSessionId);
          const assistant = this.sessionManager.getAssistant(eventSessionId);
          if (assistant?.cancelSpeaking) assistant.cancelSpeaking();
          // Don't forward to brain yet — wait for transcription text (Stage 2)
          speechState.awaitingBargeInText = true;
          // Post-barge-in echo window: TEC-check all transcriptions for 1.5s
          // to catch residual echo that arrives after TTS is cancelled
          speechState.postBargeInSuppressionUntilMs = Date.now() + 1500;
          // Safety timeout: if no transcription arrives within 3s, clear the flag
          setTimeout(() => {
            if (speechState.awaitingBargeInText) {
              speechState.awaitingBargeInText = false;
              console.log(`[Session ${eventSessionId}] BARGE-IN Stage 2: timeout — no text received`);
            }
          }, 3000);
        }
        return;
      }

      const sessionId = parsedMessage.sessionId || parsedMessage.session_id || "";
      const text = typeof parsedMessage.text === "string" ? parsedMessage.text : "";
      const isFinal = parsedMessage.is_final === true || parsedMessage.isFinal === true;

      // Mark transcription service as connected on first message
      if (text && this.dashboard && this.useRustRtp) {
        this.dashboard.updateServiceStatus("transcription", "connected", process.env.TRANSCRIPTION_SERVICES || "via Rust");
      }

      // If message has sessionId, route to specific handler
      // Dashboard emit + persistence happens inside the handler (after suppression check)
      // so echo transcriptions don't pollute the dashboard.
      if (sessionId) {
        const handler = this.sessionMessageHandlers.get(sessionId);
        if (handler) {
          handler(parsedMessage);
        }
      } else {
        // Optional legacy fallback for providers that do not emit session tags.
        if (this.allowUntaggedTranscriptBroadcast && text) {
          for (const handler of this.sessionMessageHandlers.values()) {
            handler({ text, is_final: isFinal });
          }
        } else if (text) {
          console.warn("[Controller] Ignoring untagged transcription (no sessionId)");
        }
      }
    });

    this.ws.on("close", () => {
      console.log("[Controller] Transcription WebSocket closed");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("transcription", "disconnected");
        if (this.useRustRtp) {
          this.dashboard.updateServiceStatus("rustRtp", "disconnected");
        }
      }
      // Auto-reconnect after 5 seconds
      this.scheduleTranscriptionReconnect();
    });
  }

  /**
   * Connect to the configured TTS provider (Kokoro local or ElevenLabs cloud).
   * Provider selected via TTS_PROVIDER env var (default: "kokoro").
   */
  connectTTS() {
    const provider = (process.env.TTS_PROVIDER || "kokoro").toLowerCase();

    if (provider === "elevenlabs") {
      this.connectElevenLabsTTS();
    } else {
      this.connectKokoroTTS();
    }
  }

  private connectKokoroTTS() {
    const ttsUrl = process.env.TTS_SERVICE;
    if (!ttsUrl) {
      console.log("[Controller] TTS_SERVICE not configured — text-to-speech disabled");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("tts", "disabled", "TTS_SERVICE not set");
      }
      return;
    }

    console.log(`[Controller] Connecting TTS (Kokoro): ${ttsUrl}`);
    this.ttsClient = new TtsClient(ttsUrl, {
      voice: process.env.TTS_VOICE,
      speed: parseFloat(process.env.TTS_SPEED || "1.0"),
    });

    let ttsWasConnected = false;

    this.ttsClient.on("connected", () => {
      console.log("[Controller] Kokoro TTS connected");
      ttsWasConnected = true;
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("tts", "connected", ttsUrl);
      }
    });

    this.ttsClient.on("disconnected", () => {
      if (this.dashboard) {
        if (ttsWasConnected) {
          this.dashboard.updateServiceStatus("tts", "disconnected", "Lost connection — retrying…");
          ttsWasConnected = false;
        } else {
          this.dashboard.updateServiceStatus("tts", "error", `Cannot reach ${ttsUrl}`);
        }
      }
    });

    this.ttsClient.on("error", () => {
      // "disconnected" event handles status with better context
    });

    this.ttsClient.connect();
  }

  private connectElevenLabsTTS() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.log("[Controller] ELEVENLABS_API_KEY not set — text-to-speech disabled");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("tts", "disabled", "ELEVENLABS_API_KEY not set");
      }
      return;
    }

    console.log("[Controller] Connecting TTS (ElevenLabs)...");
    this.ttsClient = new ElevenLabsTtsClient({
      apiKey,
      voiceId: process.env.ELEVENLABS_VOICE_ID,
      model: process.env.ELEVENLABS_MODEL,
      langCode: process.env.TTS_LANG,
    });

    this.ttsClient.on("connected", () => {
      console.log("[Controller] ElevenLabs TTS connected");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("tts", "connected", "ElevenLabs API");
      }
    });

    this.ttsClient.on("disconnected", () => {
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("tts", "error", "ElevenLabs API key invalid or unreachable");
      }
    });

    this.ttsClient.on("error", () => {});

    this.ttsClient.connect();
  }

  /**
   * Hot-reload TTS: close the current client and reconnect with fresh env vars.
   * Called from dashboard "Reconnect TTS" button or auto-triggered on settings save.
   * Safe mid-call: old client's pending requests reject, new client picks up next speak().
   */
  reconnectTTS() {
    if (this.ttsClient) {
      console.log("[Controller] Closing existing TTS client for reconnect...");
      this.ttsClient.close();
      this.ttsClient = null;
    }
    if (this.dashboard) {
      this.dashboard.refreshTtsLabel();
      this.dashboard.updateServiceStatus("tts", "connecting", "Reconnecting...");
    }
    this.connectTTS();
  }

  /**
   * Synthesize text and play it to the caller via Asterisk's native channel.play().
   * TTS audio is written as .sln16 to Asterisk's sounds directory (shared bind mount in Docker,
   * SFTP upload for remote Asterisk) and played using ARI playback.
   *
   * This approach works with any ExternalMedia format because it bypasses RTP injection entirely.
   * Asterisk ExternalMedia does NOT support incoming RTP with dynamic payload types (like slin16's PT=118),
   * so channel.play() is the correct path for TTS while Rust handles STT via ExternalMedia.
   */
  async speakOnChannel(
    sessionId: string,
    channel: any,
    text: string,
    assistant?: any,
    options?: { supersedeQueued?: boolean }
  ): Promise<void> {
    const trimmedText = (text || "").trim();
    if (!trimmedText) {
      this.notifySpeakingDone(assistant);
      return;
    }

    const state = this.getSessionSpeechState(sessionId);
    const normalized = this.normalizeSpeakText(trimmedText);
    const now = Date.now();

    const isRecentDuplicate =
      state.lastSpokenNormalized === normalized &&
      now - state.lastSpokenAtMs <= this.ttsDuplicateWindowMs;
    const queuedDuplicate = state.queue.some(
      (item) => this.normalizeSpeakText(item.text) === normalized
    );

    if (isRecentDuplicate || queuedDuplicate) {
      console.log(`[Session ${sessionId}] Ignoring duplicate TTS: "${trimmedText.substring(0, 80)}"`);
      this.notifySpeakingDone(assistant);
      return;
    }

    if (options?.supersedeQueued && state.queue.length > 0) {
      const dropped = state.queue.splice(0, state.queue.length);
      for (const item of dropped) {
        this.notifySpeakingDone(item.assistant);
      }
      console.log(`[Session ${sessionId}] Superseded ${dropped.length} queued TTS item(s)`);
    }

    state.queue.push({
      text: trimmedText,
      channel,
      assistant,
      queuedAtMs: now,
    });

    void this.processSpeakQueue(sessionId);
  }

  private getSessionSpeechState(sessionId: string): SessionSpeechState {
    let state = this.sessionSpeechState.get(sessionId);
    if (!state) {
      state = {
        queue: [],
        processingQueue: false,
        ttsActive: false,
        suppressTranscriptionUntilMs: 0,
        lastSpokenNormalized: "",
        lastSpokenAtMs: 0,
        recentSpokenTexts: [],
        queueStartedAtMs: 0,
        bargeInEnabled: process.env.BARGE_IN_ENABLED !== "false",
        bargeInTriggered: false,
        awaitingBargeInText: false,
        postBargeInSuppressionUntilMs: 0,
      };
      this.sessionSpeechState.set(sessionId, state);
    }
    return state;
  }

  private normalizeSpeakText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[.,!?;:'"…\-–—]/g, "") // strip punctuation for TEC matching
      .replace(/\s+/g, " ")
      .trim();
  }

  private notifySpeakingDone(assistant?: any): void {
    if (assistant?.onSpeakingDone) assistant.onSpeakingDone();
  }

  private markTranscriptionCooldown(sessionId: string): void {
    const state = this.getSessionSpeechState(sessionId);
    // Dynamic cooldown: scale with how long the bot was speaking.
    // Short utterance (< 1s) → base cooldown (800ms).
    // Longer speaking → proportionally longer cooldown, capped at max (2000ms).
    // TEC catches the longer-tail echo, so cooldown only needs to cover
    // the STT pipeline's first-result latency (~500-1500ms).
    const speakingDurationMs = state.queueStartedAtMs > 0
      ? Date.now() - state.queueStartedAtMs
      : 0;
    const dynamicCooldown = Math.min(
      this.cooldownMaxMs,
      this.cooldownBaseMs + Math.floor(speakingDurationMs * 0.3)
    );
    state.suppressTranscriptionUntilMs = Date.now() + dynamicCooldown;
  }

  private isTranscriptionSuppressed(sessionId: string, assistant?: any, text?: string): boolean {
    const state = this.getSessionSpeechState(sessionId);

    // Layer 1: Hard suppress during active TTS and speaking state.
    const assistantState = assistant?.getState?.();
    if (assistantState === "speaking") return true;
    if (state.ttsActive) return true;

    // Layer 2: Dynamic cooldown — suppress transcriptions with NO text only.
    // All transcriptions with text pass through to TEC (Layer 3) which decides
    // whether it's echo or genuine caller speech.
    // Previously used a min-word threshold (2 words) which blocked legitimate
    // single-word responses like "Yes", "Yeah", "OK", "Exactly".
    if (Date.now() < state.suppressTranscriptionUntilMs) {
      if (!text) return true;
      // Has text — fall through to TEC check below
    }

    // Textual Echo Cancellation (TEC) — inspired by Google's TEC research.
    // Compare incoming transcription against recently spoken bot text.
    // Echo from STT pipeline arrives 2-8 seconds after the bot spoke,
    // often as partial/mangled versions of the original.
    // This is the PRIMARY defense against echo — it catches "Once upon a time"
    // (matches bot text) but allows "Yeah" through (doesn't match anything).
    if (text && state.recentSpokenTexts.length > 0) {
      const normalizedInput = this.normalizeSpeakText(text);
      if (normalizedInput.length >= 2) {
        const now = Date.now();
        const TEC_WINDOW_MS = 10000; // 10 second window for echo detection
        for (const entry of state.recentSpokenTexts) {
          if (now - entry.atMs > TEC_WINDOW_MS) continue;
          if (this.isTextualEcho(normalizedInput, entry.normalized)) {
            console.log(`[Session ${sessionId}] TEC suppressed echo: "${text}"`);
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Detect if a transcription is an echo of what the bot recently spoke.
   * Echo arrives as partial/mangled versions: "Hi there!" → "Hi there.",
   * "Would you prefer to come in..." → "What would you prefer?"
   */
  private isTextualEcho(transcription: string, spoken: string): boolean {
    if (!transcription || !spoken) return false;
    // Exact match
    if (transcription === spoken) return true;
    // Word-level containment (not character-level, to avoid "here" ⊂ "there")
    const transWords = transcription.split(/\s+/).filter(w => w.length > 1);
    const spokenWords = spoken.split(/\s+/).filter(w => w.length > 1);
    // All transcription words appear in spoken text (ordered subsequence)
    if (transWords.length >= 2 && transWords.every(w => spokenWords.includes(w))) return true;
    // All spoken words appear in transcription (rare)
    if (spokenWords.length >= 2 && transWords.length > 3 && spokenWords.every(w => transWords.includes(w))) return true;
    // Word overlap ratio — echo often has >50% of the same words
    if (transWords.length < 2 || spokenWords.length < 2) return false;
    const spokenSet = new Set(spokenWords);
    const overlap = transWords.filter(w => spokenSet.has(w)).length;
    const ratio = overlap / Math.min(transWords.length, spokenWords.length);
    return ratio >= 0.5;
  }

  // ── Barge-In ──

  /**
   * Cancel current TTS playback for barge-in.
   * Stops Asterisk audio, clears the queue, resets suppression, notifies the brain.
   */
  private cancelCurrentPlayback(sessionId: string): void {
    const state = this.getSessionSpeechState(sessionId);

    console.log(`[Session ${sessionId}] Barge-in: cancelling playback`);

    // Flag to break processSpeakQueue loop
    state.bargeInTriggered = true;

    // Clear remaining queue items — they will never be spoken
    const droppedCount = state.queue.length;
    for (const item of state.queue) {
      this.notifySpeakingDone(item.assistant);
    }
    state.queue.length = 0;

    // Cancel active playback
    if (this.useRustRtp && state.currentUtteranceId) {
      // Rust path: POST cancel action
      fetch(`${this.rustServerUrl}/sessions/${sessionId}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      }).catch((err: any) => {
        console.warn(`[Session ${sessionId}] Barge-in: Rust cancel failed: ${err.message}`);
      });
    } else if (state.currentPlayback) {
      // Legacy path: stop ARI playback + unmute + cleanup audio file
      try {
        state.currentPlayback.stop((err: any) => {
          if (err) console.warn(`[Session ${sessionId}] Barge-in: playback.stop failed: ${err.message || err}`);
        });
      } catch {}
      if (state.currentChannel) {
        try {
          state.currentChannel.unmute({ direction: "in" }, () => {});
        } catch {}
      }
      if (state.currentSoundName) {
        this.cleanupTtsAudio(state.currentSoundName);
      }
    }

    // Reset suppression so the barge-in transcription is processed
    state.ttsActive = false;
    state.suppressTranscriptionUntilMs = 0;
    state.currentPlayback = undefined;
    state.currentSoundName = undefined;
    state.currentUtteranceId = undefined;
    state.currentChannel = undefined;
    state.prefetchedTtsBuffer = undefined;
    state.prefetchedTtsText = undefined;
    // Note: don't reset awaitingBargeInText here — Stage 2 still needs it

    if (droppedCount > 0) {
      console.log(`[Session ${sessionId}] Barge-in: dropped ${droppedCount} queued TTS items`);
    }
  }

  private async processSpeakQueue(sessionId: string): Promise<void> {
    const state = this.getSessionSpeechState(sessionId);
    if (state.processingQueue) return;

    state.processingQueue = true;
    state.queueStartedAtMs = Date.now();
    state.bargeInTriggered = false; // reset at queue start
    // Keep ttsActive for the ENTIRE queue — no gaps between items.
    // Previously each performSpeakOnChannel toggled ttsActive independently,
    // creating a window where echo could leak between queued sentences.
    state.ttsActive = true;
    try {
      while (state.queue.length > 0) {
        // Bail if barge-in cancelled the queue
        if (state.bargeInTriggered) {
          state.queue.length = 0;
          break;
        }

        // Bail if session ended (prevents "Channel not found" cascades)
        const session = this.sessionManager.getSession(sessionId);
        if (!session || session.status === "ended") {
          state.queue.length = 0;
          break;
        }

        const item = state.queue.shift();
        if (!item) continue;

        const spoken = await this.performSpeakOnChannel(
          sessionId,
          item.channel,
          item.text,
          item.assistant
        );

        // Prefetch result is collected inside performSpeakViaRust after playback.
        // Clear stale prefetch if barge-in cancelled the queue.
        if (state.bargeInTriggered) {
          state.prefetchedTtsBuffer = undefined;
          state.prefetchedTtsText = undefined;
        }

        if (spoken) {
          const normalized = this.normalizeSpeakText(item.text);
          state.lastSpokenNormalized = normalized;
          state.lastSpokenAtMs = Date.now();
          // Track for textual echo cancellation (keep last 10 items, prune old)
          const now = Date.now();
          state.recentSpokenTexts.push({ normalized, atMs: now });
          while (state.recentSpokenTexts.length > 10) state.recentSpokenTexts.shift();
        }
      }
    } finally {
      state.processingQueue = false;
      state.ttsActive = false;
      state.awaitingBargeInText = false;
      state.currentPlayback = undefined;
      state.currentSoundName = undefined;
      state.currentUtteranceId = undefined;
      state.currentChannel = undefined;
      if (!state.bargeInTriggered) {
        this.markTranscriptionCooldown(sessionId);
      }
    }
  }

  private async performSpeakOnChannel(
    sessionId: string,
    channel: any,
    text: string,
    assistant?: any
  ): Promise<boolean> {
    // Bail early if session ended (prevents "Channel not found" cascades)
    const sessionData = this.sessionManager.getSession(sessionId);
    if (!sessionData || sessionData.status === "ended") return false;

    // NOTE: ttsActive is managed by processSpeakQueue() — not toggled per-item.
    // This prevents echo gaps between queued sentences.
    try {
      if (!this.ttsClient?.isConnected()) {
        console.error(`[Session ${sessionId}] TTS not connected — cannot speak`);
        return false;
      }

      if (this.dashboard) {
        this.dashboard.emitSpoken({ sessionId, text });
      }

      // ── Rust AEC path: injects TTS as RTP, no mute needed ──
      if (this.useRustRtp) {
        if (!this.isRustTtsConfigured(sessionId)) {
          console.error(`[Session ${sessionId}] Rust TTS not configured — cannot speak`);
          return false;
        }
        return await this.performSpeakViaRust(sessionId, text);
      }

      // ── Legacy path (non-Rust mode only): channel.play() + mute ──
      const bargeState = this.getSessionSpeechState(sessionId);
      let soundName = "";
      try {
        if (!bargeState.bargeInEnabled) {
          channel.mute({ direction: "in" }, (err: any) => {
            if (err) console.warn(`[Session ${sessionId}] Channel mute failed: ${err.message || err}`);
          });
        }

        const localFile = await this.ttsClient.synthesize(sessionId, text);

        soundName = `tts_${sessionId}_${Date.now()}`;
        await this.deployTtsAudio(localFile, soundName);
        TtsClient.cleanupFile(localFile);

        bargeState.currentSoundName = soundName;
        bargeState.currentChannel = channel;

        await new Promise<void>((promiseResolve, promiseReject) => {
          channel.play({ media: `sound:custom/${soundName}` }, (err: any, playback: any) => {
            if (err) {
              console.error(`[Session ${sessionId}] TTS playback failed: ${err.message || err}`);
              this.cleanupTtsAudio(soundName);
              promiseReject(err);
              return;
            }

            bargeState.currentPlayback = playback;

            console.log(`[Session ${sessionId}] TTS playing: sound:custom/${soundName}`);
            let settled = false;

            playback.once("PlaybackFinished", () => {
              if (settled) return;
              settled = true;
              bargeState.currentPlayback = undefined;
              console.log(`[Session ${sessionId}] TTS playback finished`);
              this.cleanupTtsAudio(soundName);
              if (!bargeState.bargeInEnabled) {
                channel.unmute({ direction: "in" }, () => {});
              }
              promiseResolve();
            });

            setTimeout(() => {
              if (settled) return;
              settled = true;
              bargeState.currentPlayback = undefined;
              console.warn(`[Session ${sessionId}] TTS playback timeout — cleaning up`);
              this.cleanupTtsAudio(soundName);
              if (!bargeState.bargeInEnabled) {
                channel.unmute({ direction: "in" }, () => {});
              }
              promiseResolve();
            }, 60000);
          });
        });

        return true;
      } catch (err: any) {
        console.error(`[Session ${sessionId}] TTS failed: ${err.message}`);
        if (soundName) this.cleanupTtsAudio(soundName);
        try { channel.unmute({ direction: "in" }, () => {}); } catch {}
        return false;
      }
    } finally {
      this.notifySpeakingDone(assistant);
    }
  }

  /**
   * Resolve the Asterisk sounds/custom/ directory for TTS file deployment.
   *
   * Three scenarios:
   *   1. AST_SOUNDS_PATH set explicitly → use it
   *   2. Running inside Docker container → /var/lib/asterisk/sounds/custom (shared bind mount)
   *   3. Running on host with Docker Asterisk → <projectRoot>/docker/asterisk/sounds/custom
   *      (maps to /var/lib/asterisk/sounds/custom inside the Asterisk container via bind mount)
   */
  private getAstSoundsCustomDir(): string {
    if (process.env.AST_SOUNDS_PATH) {
      return `${process.env.AST_SOUNDS_PATH}/custom`;
    }
    const containerPath = "/var/lib/asterisk/sounds";
    if (fs.existsSync(containerPath)) {
      return `${containerPath}/custom`;
    }
    // Host dev mode: Docker bind mount relative to project root
    const projectRoot = path.resolve(__dirname, "..");
    return path.join(projectRoot, "docker", "asterisk", "sounds", "custom");
  }

  /**
   * Check if Asterisk is on a remote machine (requires SFTP for file deployment).
   * Remote = PBX_IP is not localhost/asterisk AND SSH_HOST is configured.
   */
  private isAsteriskRemote(): boolean {
    const pbxIp = (process.env.PBX_IP || "localhost").toLowerCase();
    const isLocal = pbxIp === "localhost" || pbxIp === "127.0.0.1" || pbxIp === "asterisk";
    return !isLocal && !!process.env.SSH_HOST && process.env.SSH_HOST !== "";
  }

  /**
   * Copy TTS audio file to Asterisk's sounds/custom/ directory.
   *
   * Strategy (in order of priority):
   *   1. Remote Asterisk (SSH_HOST set + PBX_IP is not local) → SFTP upload
   *   2. Docker Asterisk → `docker cp` into container (bypasses volume conflicts)
   *   3. Direct filesystem (arilink + Asterisk on same machine, no Docker)
   */
  private async deployTtsAudio(localFile: string, soundName: string): Promise<void> {
    const destFileName = `${soundName}.sln16`;

    if (this.isAsteriskRemote()) {
      // Remote Asterisk: upload via SFTP
      const soundsBase = process.env.AST_SOUNDS_PATH || "/var/lib/asterisk/sounds";
      const customDir = `${soundsBase}/custom`;
      const destPath = `${customDir}/${destFileName}`;
      const SftpClient = require("ssh2-sftp-client");
      const sftp = new SftpClient();
      try {
        await sftp.connect({
          host: process.env.SSH_HOST,
          port: parseInt(process.env.SSH_PORT || "22"),
          username: process.env.SSH_USER,
          password: process.env.SSH_PASSWORD,
        });
        try { await sftp.mkdir(customDir, true); } catch {}
        await sftp.put(localFile, destPath);
      } finally {
        await sftp.end().catch(() => {});
      }
      return;
    }

    // Docker Asterisk: use `docker cp` (the andrius/asterisk image declares
    // VOLUME /var/lib/asterisk/sounds which overrides compose bind mounts)
    const container = process.env.ASTERISK_CONTAINER || "arilink-asterisk";
    const containerDest = `/var/lib/asterisk/sounds/custom/${destFileName}`;
    try {
      // Ensure custom dir exists inside container
      execFileSync("docker", ["exec", container, "mkdir", "-p", "/var/lib/asterisk/sounds/custom"], {
        stdio: "pipe",
      });
      // Copy file into container
      execFileSync("docker", ["cp", localFile, `${container}:${containerDest}`], {
        stdio: "pipe",
      });
      return;
    } catch (e: any) {
      // docker cp failed — fall through to direct filesystem
      console.warn(`[TTS] docker cp failed (${e.message}), trying direct filesystem`);
    }

    // Direct filesystem fallback (no Docker)
    const customDir = this.getAstSoundsCustomDir();
    if (!fs.existsSync(customDir)) {
      fs.mkdirSync(customDir, { recursive: true });
    }
    fs.copyFileSync(localFile, path.join(customDir, destFileName));
  }

  /**
   * Remove a TTS audio file from Asterisk's sounds directory (fire-and-forget).
   */
  private cleanupTtsAudio(soundName: string): void {
    const destFileName = `${soundName}.sln16`;

    if (this.isAsteriskRemote()) {
      const soundsBase = process.env.AST_SOUNDS_PATH || "/var/lib/asterisk/sounds";
      const destPath = `${soundsBase}/custom/${destFileName}`;
      const SftpClient = require("ssh2-sftp-client");
      const sftp = new SftpClient();
      sftp.connect({
        host: process.env.SSH_HOST,
        port: parseInt(process.env.SSH_PORT || "22"),
        username: process.env.SSH_USER,
        password: process.env.SSH_PASSWORD,
      }).then(() => sftp.delete(destPath).finally(() => sftp.end()))
        .catch(() => {});
      return;
    }

    // Docker Asterisk: remove via docker exec (fire-and-forget)
    const container = process.env.ASTERISK_CONTAINER || "arilink-asterisk";
    const containerPath = `/var/lib/asterisk/sounds/custom/${destFileName}`;
    execFile("docker", ["exec", container, "rm", "-f", containerPath], () => {});

    // Also try local filesystem (fallback)
    const customDir = this.getAstSoundsCustomDir();
    try { fs.unlinkSync(path.join(customDir, destFileName)); } catch {}
  }

  private transcriptionReconnectTimer: any = null;

  private scheduleTranscriptionReconnect() {
    if (this.transcriptionReconnectTimer) return;
    console.log("[Controller] Scheduling transcription WS reconnect in 5s...");
    this.transcriptionReconnectTimer = setTimeout(() => {
      this.transcriptionReconnectTimer = null;
      console.log("[Controller] Attempting transcription WS reconnect...");
      this.connectTranscriptionWS();
    }, 5000);
  }

  private ariReconnectTimer: any = null;

  private scheduleARIReconnect() {
    if (this.ariReconnectTimer) return;
    console.log("[Controller] Scheduling ARI reconnect in 10s...");
    this.ariReconnectTimer = setTimeout(async () => {
      this.ariReconnectTimer = null;
      try {
        console.log("[Controller] Attempting ARI reconnect...");
        await this.connectARI();
        this.startARILoop();
        if (this.dashboard) {
          this.dashboard.updateServiceStatus("asterisk", "connected", this.pbxIP);
        }
        console.log("[Controller] ARI reconnected successfully");
        // Purge sessions whose channels died during the disconnect
        await this.reconcileSessions();
      } catch (err: any) {
        console.error(`[Controller] ARI reconnect failed: ${err.message}`);
        this.scheduleARIReconnect(); // Retry again
      }
    }, 10000);
  }

  /**
   * After ARI reconnect, check tracked sessions against live ARI channels.
   * Purge any session whose incoming channel no longer exists.
   */
  private async reconcileSessions() {
    if (!this.client) return;

    const activeIds = this.sessionManager.getActiveSessionIds();
    if (activeIds.length === 0) return;

    console.log(`[Controller] Reconciling ${activeIds.length} session(s) after reconnect...`);

    let liveChannelIds: Set<string>;
    try {
      const channels = await this.client.channels.list();
      liveChannelIds = new Set((channels || []).map((ch: any) => ch.id));
    } catch (err: any) {
      console.error(`[Controller] Failed to list channels for reconciliation: ${err.message}`);
      return;
    }

    let purged = 0;
    for (const sessionId of activeIds) {
      const session = this.sessionManager.getSession(sessionId);
      if (!session) continue;

      const incomingAlive = session.incomingChannel?.id && liveChannelIds.has(session.incomingChannel.id);
      if (!incomingAlive) {
        console.log(`[Controller] Purging stale session ${sessionId} — incoming channel gone`);
        this.sessionMessageHandlers.delete(sessionId);
        this.sessionSpeechState.delete(sessionId);
        this.deleteRustSession(sessionId);
        if (this.dashboard) this.dashboard.emitCallEnded(sessionId);
        if (this.callHistory) this.callHistory.endCall(sessionId);
        this.sessionManager.endSession(sessionId);
        purged++;
      }
    }

    if (purged > 0) {
      console.log(`[Controller] Purged ${purged} stale session(s)`);
    }
  }

  async stasisStart(event: any, channel: any) {
    const dialed = event.args[0] === "dialed";
    const channelName = event["channel"]["name"];

    console.log(
      util.format(
        "Channel %s just entered our application",
        channel.name
      )
    );

    await channel.answer();

    if (event.args[0] === "campaign") {
      // Campaign call originated by AutoDialer — full pipeline (same as incoming)
      const sessionId = event.args[1];
      const assistantSlug = event.args[2];
      const callerId = event.args[3] || "unknown";
      const phone = event.args[4] || "";
      const callerName = event.args[5] ? decodeURIComponent(event.args[5]) : "";
      console.log(`[Controller] Campaign call for ${phone} (session ${sessionId})`);
      try {
        await this.handleCampaignCall(channel, sessionId, assistantSlug, callerId, phone, callerName);
      } catch (err: any) {
        console.error(`[Controller] handleCampaignCall failed: ${err.message || err}`);
        try { this.playAudio(channel, "beep"); } catch { }
      }
    } else if (dialed) {
      // Outgoing channel (dialed party) - find its session and add to bridge
      console.log("This channel is dialed (outgoing)");

      // Find the session that initiated this outgoing call
      // The session ID is passed in the channel variables or we match by context
      const session = this.findSessionForOutgoingChannel(channel);
      if (session) {
        this.sessionManager.setOutgoingChannel(session.id, channel);
        this.addChannelToBridge(channel, session.bridge);
      } else {
        console.warn("Could not find session for outgoing channel");
      }
    } else if (channelName.startsWith("UnicastRTP")) {
      // External media channel (IN or OUT) - find its session
      console.log("This is an external media channel");
      const session = this.sessionManager.getSessionByExternalMediaId(channel.id)
        || this.sessionManager.getSessionByExternalMediaOutId(channel.id);
      if (session) {
        this.addChannelToBridge(channel, session.bridge);
      }
    } else {
      // New incoming call - create a new session
      console.log("New incoming call - creating session");
      try {
        await this.handleIncomingCall(channel);
      } catch (err: any) {
        console.error(`[Controller] handleIncomingCall failed: ${err.message || err}`);
        // Try to play an error tone so the caller knows something is wrong
        try { this.playAudio(channel, "beep"); } catch { }
      }
    }
  }

  /**
   * Handle a new incoming call by creating an isolated session with an assistant
   */
  async handleIncomingCall(channel: any) {
    // Generate unique session ID
    const sessionId = this.sessionManager.generateSessionId();

    // Create dedicated bridge for this call
    const bridge = await this.createBridgeForSession(sessionId);

    // Create the session
    const session = this.sessionManager.createSession(
      sessionId,
      bridge,
      channel
    );

    console.log(`[Session ${sessionId}] New incoming call from ${channel.name}`);

    // Add incoming channel to its dedicated bridge
    this.addChannelToBridge(channel, bridge);

    // Create ExternalMedia channel → Asterisk starts sending RTP to Rust port 8000
    await this.createExternalMediaChannelForSession(sessionId);

    // Explicitly add ExternalMedia to bridge (don't rely on StasisStart event —
    // there's a race condition where the event fires before setExternalMediaChannelId)
    const emChannelId = this.sessionManager.getSession(sessionId)?.externalMediaChannelId;
    if (emChannelId) {
      bridge.addChannel({ channel: emChannelId }, (err: any) => {
        if (err) console.warn(`[Session ${sessionId}] ExternalMedia bridge add: ${err.message || err}`);
        else console.log(`[Session ${sessionId}] ExternalMedia channel added to bridge`);
      });
    }

    await this.createRustSession(sessionId);

    // Configure Rust TTS (bidirectional slin16 on same ExternalMedia channel).
    // Rust auto-detects Asterisk's RTP source from incoming packets on port 8000.
    if (this.useRustRtp) {
      await this.configureRustTts(sessionId);
    }

    // Create assistant for this session
    // Priority: 1) DEFAULT_ASSISTANT env var (global override from dashboard)
    //           2) Extension-based routing (config/routing.json)
    //           3) "ivr-transfer" (hardcoded fallback)
    const extension = channel.dialplan?.exten || "unknown";
    const callerId = channel.caller?.number || "unknown";

    let assistant: any;
    const globalOverride = process.env.DEFAULT_ASSISTANT;
    console.log(`[Session ${sessionId}] DEFAULT_ASSISTANT="${globalOverride || ""}" extension="${extension}" callerID="${callerId}"`);
    if (globalOverride) {
      // Dashboard "Switch Assistant" override — always use this
      assistant = AssistantFactory.createByType(
        globalOverride, this.client, sessionId, this.contacts
      );
    } else {
      // Routing chain: DID/extension → callerID → fallback
      assistant = AssistantFactory.createFromRouting(
        extension, callerId, this.client, sessionId, this.contacts
      );
    }
    const assistantType = assistant.getConfig().name;

    console.log(`[Session ${sessionId}] Using assistant: ${assistantType}`);

    // Store assistant in session
    this.sessionManager.setAssistant(sessionId, assistant);

    // Listen for assistant events
    this.setupAssistantEventHandlers(session, assistant, channel);

    // Set up session-specific transcription handler (routes to assistant)
    this.setupSessionTranscriptionHandler(session);

    // Notify dashboard & persist BEFORE assistant starts (playback may block/hang)
    const callData = {
      id: sessionId,
      callerId,
      callerName: channel.caller?.name || "",
      extension,
      channelName: channel.name || "",
      assistant: assistantType,
      assistantName: assistantType,
      startTime: new Date().toISOString(),
      status: "active",
    };
    if (this.dashboard) {
      this.dashboard.emitCallUpdate(callData);
    }
    if (this.callHistory) {
      this.callHistory.saveCall(callData);
    }

    // Let the assistant handle call start (plays welcome, sets state).
    // BargeInError can propagate if the user speaks during the welcome —
    // that's fine, the brain handles it via onBargeIn + queued text.
    try {
      await assistant.onCallStart(channel, callerId, extension);
    } catch (err: any) {
      if (err?.name === "BargeInError") {
        console.log(`[Session ${sessionId}] Welcome interrupted by barge-in — continuing normally`);
      } else {
        throw err; // Re-throw non-barge-in errors
      }
    }
  }

  /**
   * Handle a campaign call originated by AutoDialer.
   * Same full pipeline as handleIncomingCall (bridge, RTP, transcription, assistant).
   */
  async handleCampaignCall(
    channel: any,
    sessionId: string,
    assistantSlug: string,
    campaignCallerId: string,
    campaignPhone: string,
    campaignCallerName: string,
  ) {
    // Create dedicated bridge
    const bridge = await this.createBridgeForSession(sessionId);

    // Create session (using AutoDialer's pre-generated sessionId)
    const session = this.sessionManager.createSession(sessionId, bridge, channel);

    // Store campaign-specific info for dashboard display
    (session as any).campaignCallerId = campaignCallerId;
    (session as any).campaignCallerName = campaignCallerName;
    (session as any).campaignPhone = campaignPhone;

    console.log(`[Session ${sessionId}] Campaign call: ${campaignCallerId} → ${campaignPhone}`);

    // Add channel to its dedicated bridge
    this.addChannelToBridge(channel, bridge);

    // Create ExternalMedia → Asterisk sends RTP to Rust port 8000
    await this.createExternalMediaChannelForSession(sessionId);

    // Explicitly add ExternalMedia to bridge (race condition workaround)
    const emCampaignChannelId = this.sessionManager.getSession(sessionId)?.externalMediaChannelId;
    if (emCampaignChannelId) {
      bridge.addChannel({ channel: emCampaignChannelId }, (err: any) => {
        if (err) console.warn(`[Session ${sessionId}] ExternalMedia bridge add: ${err.message || err}`);
        else console.log(`[Session ${sessionId}] ExternalMedia channel added to bridge`);
      });
    }

    await this.createRustSession(sessionId);

    // Configure Rust TTS (auto-detects Asterisk's RTP source from port 8000)
    if (this.useRustRtp) {
      await this.configureRustTts(sessionId);
    }

    // Create assistant
    const assistant = AssistantFactory.createByType(assistantSlug, this.client, sessionId, this.contacts);
    this.sessionManager.setAssistant(sessionId, assistant);

    // Wire assistant events (state changes, transfers, DTMF) to dashboard
    this.setupAssistantEventHandlers(session, assistant, channel);

    // Route transcriptions to the assistant
    this.setupSessionTranscriptionHandler(session);

    // Store callResult on session so AutoDialer can read it at StasisEnd
    assistant.on("callResult", (data: { result: string }) => {
      (session as any).campaignResult = data.result;
    });

    // Notify dashboard & persist
    const callData = {
      id: sessionId,
      callerId: campaignCallerId,
      callerName: campaignCallerName,
      extension: campaignPhone,
      channelName: channel.name || "",
      assistant: assistantSlug,
      assistantName: assistant.getConfig()?.name || assistantSlug,
      startTime: new Date().toISOString(),
      status: "active",
    };
    if (this.dashboard) {
      this.dashboard.emitCallUpdate(callData);
    }
    if (this.callHistory) {
      this.callHistory.saveCall(callData);
    }

    // Let the assistant handle call start
    await assistant.onCallStart(channel, campaignPhone, campaignPhone);
  }

  /**
   * Set up transcription handler for a specific session.
   * Routes transcriptions to the session's assistant.
   */
  setupSessionTranscriptionHandler(session: CallSessionData) {
    const sessionId = session.id;

    const handler = (message: any) => {
      const text =
        typeof message?.text === "string"
          ? message.text.trim()
          : typeof message?.data === "string"
            ? message.data.trim()
            : typeof message === "string"
              ? message.trim()
              : "";
      const isFinal = message?.is_final === true || message?.isFinal === true;
      if (!text) return;

      console.log(`[Session ${sessionId}] Received transcription: ${text}`);

      const assistant = this.sessionManager.getAssistant(sessionId);
      if (assistant) {
        // ── Two-stage barge-in ──
        // Stage 1 (user_speaking event): audio stopped immediately by energy detection
        // Stage 2 (here): validate transcription text — echo check, then forward to brain
        const speechState = this.getSessionSpeechState(sessionId);
        if (speechState.bargeInEnabled && text) {
          const bargeNorm = this.normalizeSpeakText(text);

          // TEC: check if transcription is echo of what the bot just said
          let isEcho = false;
          if (bargeNorm.length >= 2 && speechState.recentSpokenTexts.length > 0) {
            const now = Date.now();
            for (const entry of speechState.recentSpokenTexts) {
              if (now - entry.atMs > 10000) continue;
              if (this.isTextualEcho(bargeNorm, entry.normalized)) {
                isEcho = true;
                break;
              }
            }
          }

          // Stage 2: text arrived after energy-based audio stop
          if (speechState.awaitingBargeInText) {
            speechState.awaitingBargeInText = false;

            if (isEcho) {
              // False alarm — the "speech" was actually residual echo
              console.log(`[Session ${sessionId}] BARGE-IN Stage 2: echo discarded "${text}"`);
              return;
            }

            // Real speech confirmed — forward to brain as new turn.
            // No backchannel filtering here — the LLM decides how to handle
            // short utterances like "yeah"/"okay" using the interrupted context in history.
            console.log(`[Session ${sessionId}] BARGE-IN Stage 2: confirmed "${text}"`);
            if (assistant.notifyBargeIn) assistant.notifyBargeIn(text);

            // Emit to dashboard + persist
            if (this.dashboard) {
              this.dashboard.emitTranscription({ sessionId, text, is_final: isFinal });
            }
            if (this.callHistory && isFinal) {
              try {
                this.callHistory.saveTranscription({
                  callId: sessionId, text, isFinal: true,
                  timestamp: new Date().toISOString(),
                });
              } catch {}
            }

            assistant.onTranscription(text, isFinal);
            return;
          }

          // During TTS without energy detection (VAD) trigger: suppress.
          // Barge-in relies on VAD-based user_speaking events from Rust AEC thread.
          // If VAD didn't fire, this transcription is echo or noise.
          if (speechState.ttsActive) {
            console.log(`[Session ${sessionId}] Suppressed during TTS: "${text}" (echo=${isEcho})`);
            return;
          }

          // Post-barge-in echo window: after TTS is cancelled, residual audio
          // in the pipeline still gets transcribed for ~1-1.5s. Apply TEC check
          // to catch these late echo fragments (e.g., "On a time." from "Once upon a time").
          if (Date.now() < speechState.postBargeInSuppressionUntilMs && isEcho) {
            console.log(`[Session ${sessionId}] Post-barge-in echo suppressed: "${text}"`);
            return;
          }
        }

        if (this.isTranscriptionSuppressed(sessionId, assistant, text)) {
          console.log(`[Session ${sessionId}] Suppressed echo: "${text}"`);
          return;
        }

        // Emit to dashboard + persist ONLY for non-suppressed transcriptions.
        // This keeps echo text out of the dashboard transcript.
        if (this.dashboard) {
          this.dashboard.emitTranscription({ sessionId, text, is_final: isFinal });
        }
        if (this.callHistory && isFinal) {
          try {
            this.callHistory.saveTranscription({
              callId: sessionId,
              text,
              isFinal: true,
              timestamp: new Date().toISOString(),
            });
          } catch (err: any) {
            console.error(`[CallHistory] Failed to save transcription for ${sessionId}:`, err.message);
          }
        }

        assistant.onTranscription(text, isFinal);
      }
    };

    this.sessionMessageHandlers.set(sessionId, handler);
  }

  /**
   * Set up event handlers for an assistant instance.
   * Listens for transfer, contact match, and other assistant events.
   */
  setupAssistantEventHandlers(session: CallSessionData, assistant: any, channel: any) {
    const sessionId = session.id;

    // Handle transfer to configured destination (extension, ring group, external SIP endpoint)
    // Priority: assistant config.json > .env vars
    assistant.on("transferToDestination", async (data: { sessionId: string; callerName: string }) => {
      console.log(`[Session ${sessionId}] Assistant requested transfer for "${data.callerName}"`);

      const config = assistant.getConfig();
      const destination = config.transfer?.destination || process.env.TRANSFER_DESTINATION;
      const trunkName = config.transfer?.trunk || process.env.TRANSFER_TRUNK;

      if (!destination || !trunkName) {
        console.error(`[Session ${sessionId}] Transfer not configured (set transfer in config.json or TRANSFER_DESTINATION/TRANSFER_TRUNK in .env)`);
        this.playAudio(channel, "beep");
        return;
      }

      // Transfer to configured destination
      await this.transferToDestination(session, channel, destination, trunkName, data.callerName);
    });

    // Handle contact match (direct dialing)
    assistant.on("contactMatched", async (data: { sessionId: string; name: string; number: string }) => {
      console.log(`[Session ${sessionId}] Contact matched: ${data.name} → ${data.number}`);
      // Contact matched, initiate outgoing call
      this.initiateOutgoingCall(session, channel, data.number);
      this.sessionMessageHandlers.delete(sessionId);
      this.sessionSpeechState.delete(sessionId);
      this.deleteRustSession(sessionId);
    });

    // Broadcast assistant state changes to dashboard
    assistant.on("stateChange", (data: { sessionId: string; prev: string; state: string }) => {
      if (data.prev === "speaking" && data.state !== "speaking") {
        this.markTranscriptionCooldown(sessionId);
      }
      if (this.dashboard) {
        this.dashboard.emitAssistantState(data);
      }
    });

    // Handle generic transfer request
    assistant.on("transfer", async (data: { endpoint: string; sessionId: string }) => {
      console.log(`[Session ${sessionId}] Transfer requested to: ${data.endpoint}`);
      this.initiateOutgoingCall(session, channel, data.endpoint);
      this.sessionMessageHandlers.delete(sessionId);
      this.sessionSpeechState.delete(sessionId);
      this.deleteRustSession(sessionId);
    });

    // ── OpenClaw-specific events ──

    // Forward transcriptions to connected OpenClaw plugin instances
    // Map sessionId → callId for the Socket.IO protocol (channel plugin expects callId)
    assistant.on("openclawTranscription", (data: { sessionId: string; text: string; isFinal: boolean; callerNumber?: string }) => {
      if (this.dashboard?.hasOpenClawClients()) {
        this.dashboard.emitOpenClawTranscription({
          callId: data.sessionId,
          text: data.text,
          isFinal: data.isFinal,
          callerNumber: data.callerNumber,
        });
      }
    });

    // Notify OpenClaw that a call started
    assistant.on("openclawCallStarted", (data: { sessionId: string; callerId: string; extension: string }) => {
      if (this.dashboard?.hasOpenClawClients()) {
        this.dashboard.emitOpenClawCallStarted({
          callId: data.sessionId,
          number: data.callerId,
          direction: "inbound",
        });
      }
    });

    // Notify OpenClaw that a call ended
    assistant.on("openclawCallEnded", (data: { sessionId: string; reason?: string }) => {
      if (this.dashboard?.hasOpenClawClients()) {
        this.dashboard.emitOpenClawCallEnded({
          callId: data.sessionId,
          reason: data.reason,
        });
      }
    });

    // OpenClaw wants to speak to the caller via TTS
    assistant.on("openclawSpeak", (data: { sessionId: string; text: string }) => {
      this.speakOnChannel(sessionId, channel, data.text, assistant, { supersedeQueued: true });
    });

    // BrainHarness speak request — any brain can request TTS
    assistant.on("speakRequest", (data: { sessionId: string; text: string }) => {
      this.speakOnChannel(sessionId, channel, data.text, assistant);
    });
  }

  /**
   * Transfer a call to a configured destination via SIP trunk
   * Destination can be: FreePBX extension, ring group, queue, or external SIP endpoint
   */
  async transferToDestination(
    session: CallSessionData,
    channel: any,
    destination: string,
    trunkName: string,
    callerName: string
  ): Promise<void> {
    console.log(`[Session ${session.id}] Transferring to ${destination} via ${trunkName}`);

    const endpoint = `PJSIP/${destination}@${trunkName}`;

    const fromNumber = channel.caller?.number || process.env.FROM_NUMBER || "unknown";
    const appName = process.env.STASIS_APP_NAME || "stasis-app";

    const outgoingChannelParams = {
      endpoint: endpoint,
      app: appName,
      callerId: fromNumber,
      appArgs: "dialed",
      headers: {
        "X-Session-ID": session.id,
        "X-Caller-Name": callerName,
      },
    };

    try {
      await this.client.channels.originate(
        outgoingChannelParams,
        (err: any, outgoingChannel: any) => {
          if (err) {
            console.error(`[Session ${session.id}] Transfer to ${destination} failed:`, err);
            this.playAudio(channel, "beep");
            return;
          }

          console.log(`[Session ${session.id}] Outgoing channel to ${destination}: ${outgoingChannel.id}`);

          outgoingChannel.on("StasisStart", (event: any, outChannel: any) => {
            this.sessionManager.setOutgoingChannel(session.id, outChannel);

            this.addChannelToBridge(outChannel, session.bridge);
            console.log(`[Session ${session.id}] Bridged to ${destination}`);
          });

          const callStartTime = moment().format("YYYY-MM-DD HH:mm:ss");

          outgoingChannel.on("StasisEnd", (event: any) => {
            const callEndTime = moment().format("YYYY-MM-DD HH:mm:ss");
            const date = new Date().toISOString().split("T")[0];
            this.registerOutgoingCallUsage(fromNumber, destination, callStartTime, callEndTime, date);
          });
        }
      );
    } catch (error) {
      console.error(`[Session ${session.id}] Error during transfer to ${destination}:`, error);
    }
  }

  /**
   * Find session for an outgoing channel (matched by bridge membership or metadata)
   */
  findSessionForOutgoingChannel(channel: any): CallSessionData | undefined {
    // For now, find the most recent pending session
    // In production, you'd want to pass session ID via channel variables
    for (const session of Array.from(
      this.sessionManager.getActiveSessionIds()
    )) {
      const sessionData = this.sessionManager.getSession(session);
      if (sessionData && sessionData.status === "pending") {
        return sessionData;
      }
    }
    return undefined;
  }

  async initiateOutgoingCall(
    session: CallSessionData,
    dialingChannel: any,
    recipient: string
  ) {
    const fromNumber = process.env.FROM_NUMBER || "unknown";
    const appName = process.env.STASIS_APP_NAME || "stasis-app";
    const trunkContext = process.env.TRANSFER_TRUNK || "from-internal";

    const outgoingChannelParams = {
      endpoint: `Local/${recipient}@${trunkContext}`,
      app: appName,
      callerId: fromNumber,
      appArgs: "dialed",
      headers: {
        "X-Custom-Caller-ID": fromNumber,
        "X-Custom-Recipient": recipient,
        "X-Session-ID": session.id,
      },
    };

    let ringingPlayback: any;
    dialingChannel.play(
      { media: "tone:ring;tonezone=fr" },
      (err: any, newPlayback: any) => {
        if (err) {
          console.error(`[Session ${session.id}] Error playing ring tone:`, err);
          return;
        }
        ringingPlayback = newPlayback;
      }
    );

    await this.client.channels.originate(
      outgoingChannelParams,
      (err: any, channel: any) => {
        if (err) {
          console.error(
            `[Session ${session.id}] Error initiating outgoing call:`,
            err
          );
          return;
        }

        console.log(`[Session ${session.id}] Outgoing call initiated`);

        channel.on("StasisStart", (event: any, outChannel: any) => {
          // Update session with outgoing channel
          this.sessionManager.setOutgoingChannel(session.id, outChannel);

          const outgoingWelcome = process.env.OUTGOING_WELCOME_SOUND || "custom/welcome_2";
          outChannel.play(
            { media: `sound:${outgoingWelcome}` },
            (err: any, playback: any) => {
              if (err) {
                console.error("Error playing ringing tone:", err);
                return;
              }

              playback.once("PlaybackFinished", (completedPlayback: any) => {
                console.log(
                  `[Session ${session.id}] Ringing tone playback finished`
                );
                if (ringingPlayback) {
                  ringingPlayback.stop();
                }
                this.playAudio(outChannel, "beep");
              });
            }
          );
        });

        // Store call timing for usage registration
        const callStartTime = moment().format("YYYY-MM-DD HH:mm:ss");

        channel.on("StasisEnd", (event: any, endedChannel: any) => {
          const callEndTime = moment().format("YYYY-MM-DD HH:mm:ss");
          const date = new Date().toISOString().split("T")[0];

          this.registerOutgoingCallUsage(
            fromNumber,
            recipient,
            callStartTime,
            callEndTime,
            date
          );
        });
      }
    );
  }

  stasisEnd(event: any, channel: any) {
    const channelId = channel.id;
    console.log(`Channel ${channelId} just left the Stasis application`);

    // Find the session this channel belongs to
    const session = this.sessionManager.getSessionByChannelId(channelId);

    if (session) {
      console.log(
        `[Session ${session.id}] Channel ${channel.name} ended`
      );

      // Notify assistant of call end
      const assistant = this.sessionManager.getAssistant(session.id);
      if (assistant) {
        assistant.onCallEnd(channel);
      }

      // Clean up the session's message handler
      this.sessionMessageHandlers.delete(session.id);
      this.sessionSpeechState.delete(session.id);

      // Clean up Rust RTP session
      this.deleteRustSession(session.id);

      // Notify dashboard
      if (this.dashboard) {
        this.dashboard.emitCallEnded(session.id);
      }

      // Persist call end to history
      if (this.callHistory) {
        this.callHistory.endCall(session.id);
      }

      // End only this session, not all calls
      this.sessionManager.endSession(session.id);
    } else {
      console.log(`Channel ${channelId} was not associated with any session`);
    }
  }

  dtmfReceived(event: any, channel: any) {
    const digit = event.digit;
    console.log(`Channel ${channel.name} DTMF: ${digit}`);

    // Find session for this channel and route to assistant
    const session = this.sessionManager.getSessionByChannelId(channel.id);
    if (session) {
      // Broadcast DTMF to dashboard
      if (this.dashboard) {
        this.dashboard.emitDTMF({ sessionId: session.id, digit });
      }

      const assistant = this.sessionManager.getAssistant(session.id);
      if (assistant) {
        assistant.onDTMFInput(digit);
      }
    }
  }

  async createExternalMediaChannelForSession(sessionId: string): Promise<void> {
    const ariEndpoint = `http://${this.pbxIP}:8088/ari`;
    const appName = process.env.STASIS_APP_NAME || "stasis-app";
    const externalHost = process.env.EXTERNAL_HOST;
    const format = "g722";
    const username = process.env.ASTERISK_LOGIN;
    const password = process.env.ASTERISK_PASSWORD;
    const port = parseInt(process.env.RTP_LISTEN_PORT || "8000", 10);

    const url = `${ariEndpoint}/channels/externalMedia?app=${appName}&external_host=${externalHost}%3A${port}&format=${format}&direction=both`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${username}:${password}`
          ).toString("base64")}`,
        },
      });

      const data = await response.json();

      if (data && data.id) {
        this.sessionManager.setExternalMediaChannelId(sessionId, data.id);
        console.log(
          `[Session ${sessionId}] External media channel created: ${data.id}`
        );
      } else {
        console.error(
          `[Session ${sessionId}] ExternalMedia creation failed — no channel ID in response:`,
          JSON.stringify(data)
        );
      }
    } catch (error: any) {
      console.error(
        `[Session ${sessionId}] Error creating ExternalMedia channel:`,
        error.message
      );
    }
  }

  /**
   * Configure TTS injection on the Rust RTP server for a session.
   * Uses the same ExternalMedia channel as mic audio (bidirectional slin16).
   * Rust sends TTS RTP from port 8000 back to Asterisk's local RTP address.
   */
  async configureRustTts(sessionId: string): Promise<void> {
    if (!this.useRustRtp) return;

    try {
      // No address needed — Rust auto-detects from incoming RTP on port 8000.
      // The endpoint polls up to 3s for the first RTP packet to arrive.
      const response = await fetch(`${this.rustServerUrl}/sessions/${sessionId}/configure-tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      console.log(`[Session ${sessionId}] Rust TTS configured:`, data);
      if (data?.status === "ok") {
        const session = this.sessionManager.getSession(sessionId);
        if (session) (session as any).rustTtsConfigured = true;
      } else {
        console.error(`[Session ${sessionId}] Rust TTS config failed:`, data);
      }
    } catch (err: any) {
      console.error(`[Session ${sessionId}] Failed to configure Rust TTS: ${err.message}`);
    }
  }

  /**
   * Check if Rust TTS is configured for a session.
   */
  private isRustTtsConfigured(sessionId: string): boolean {
    const session = this.sessionManager.getSession(sessionId);
    return !!(session as any)?.rustTtsConfigured;
  }

  /**
   * Speak via Rust AEC path: synthesize to buffer → stream to Rust → Rust injects RTP.
   * No mute needed — AEC cancels the echo from the bridge mix.
   */
  private async performSpeakViaRust(sessionId: string, text: string): Promise<boolean> {
    const rustState = this.getSessionSpeechState(sessionId);
    try {
      // Use prefetched buffer if available and matching, otherwise synthesize
      let pcmBuffer: Buffer;
      if (rustState.prefetchedTtsBuffer && rustState.prefetchedTtsText === text) {
        pcmBuffer = rustState.prefetchedTtsBuffer;
        rustState.prefetchedTtsBuffer = undefined;
        rustState.prefetchedTtsText = undefined;
      } else {
        rustState.prefetchedTtsBuffer = undefined;
        rustState.prefetchedTtsText = undefined;
        pcmBuffer = await this.ttsClient.synthesizeToBuffer(sessionId, text);
      }

      const utteranceId = `${sessionId}-${Date.now()}`;
      // Store for barge-in cancellation
      rustState.currentUtteranceId = utteranceId;

      // Stream PCM audio to Rust
      await this.streamTtsToRust(sessionId, pcmBuffer);

      // Signal "done" so Rust flushes remaining audio and sends tts_playback_done
      await fetch(`${this.rustServerUrl}/sessions/${sessionId}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "done", utterance_id: utteranceId }),
      });

      // While Rust paces audio in real-time, prefetch TTS for the next queued sentence.
      // This eliminates the ~200-400ms synthesis gap between sentences.
      const nextItem = rustState.queue[0];
      let prefetchPromise: Promise<Buffer> | null = null;
      if (nextItem && this.ttsClient?.isConnected() && !rustState.bargeInTriggered) {
        prefetchPromise = this.ttsClient.synthesizeToBuffer(sessionId, nextItem.text).catch(() => null as any);
      }

      // Wait for Rust to finish real-time RTP pacing
      await this.waitForTtsPlaybackDone(sessionId, utteranceId, 60000);

      // Collect prefetch result (synthesis ran in parallel with playback)
      if (prefetchPromise && !rustState.bargeInTriggered && rustState.queue[0] === nextItem) {
        const prefetched = await prefetchPromise;
        if (prefetched) {
          rustState.prefetchedTtsBuffer = prefetched;
          rustState.prefetchedTtsText = nextItem.text;
        }
      }

      rustState.currentUtteranceId = undefined;
      return true;
    } catch (err: any) {
      rustState.currentUtteranceId = undefined;
      rustState.prefetchedTtsBuffer = undefined;
      rustState.prefetchedTtsText = undefined;
      console.error(`[Session ${sessionId}] Rust TTS failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Stream raw PCM audio to the Rust RTP server for TTS injection.
   */
  private async streamTtsToRust(sessionId: string, pcmBuffer: Buffer): Promise<void> {
    const response = await fetch(`${this.rustServerUrl}/sessions/${sessionId}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcmBuffer as any,
    });

    if (!response.ok) {
      throw new Error(`Rust TTS stream failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Wait for Rust to signal TTS playback completion via WebSocket.
   */
  private waitForTtsPlaybackDone(
    sessionId: string,
    utteranceId: string,
    timeoutMs: number
  ): Promise<void> {
    return new Promise((promiseResolve) => {
      const key = `${sessionId}:${utteranceId}`;
      const timer = setTimeout(() => {
        this.ttsPlaybackListeners.delete(key);
        console.warn(`[Session ${sessionId}] TTS playback timeout for ${utteranceId}`);
        promiseResolve();
      }, timeoutMs);

      this.ttsPlaybackListeners.set(key, { resolve: promiseResolve, timer });
    });
  }

  /**
   * Create a session on the Rust RTP server (only when USE_RUST_RTP is active).
   * Source address is auto-detected from incoming RTP packets.
   */
  async createRustSession(sessionId: string): Promise<void> {
    if (!this.useRustRtp) return;

    // RUST_TRANSCRIPTION_SERVICES overrides for when Rust is in Docker but Node.js is on host
    // (localhost from host ≠ localhost inside container — use Docker network names instead)
    const transcriptionServices = (process.env.RUST_TRANSCRIPTION_SERVICES || process.env.TRANSCRIPTION_SERVICES || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    const body: any = {
      session_id: sessionId,
      codec: "g722",
      transcription_services: transcriptionServices,
      aec_enabled: true, // Enable AEC for full-duplex TTS via Rust
    };

    try {
      const response = await fetch(`${this.rustServerUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      console.log(`[Session ${sessionId}] Rust session created:`, data);
    } catch (error: any) {
      console.error(`[Session ${sessionId}] Failed to create Rust session:`, error.message);
    }
  }

  /**
   * Delete a session on the Rust RTP server (only when USE_RUST_RTP is active)
   */
  async deleteRustSession(sessionId: string): Promise<void> {
    if (!this.useRustRtp) return;

    try {
      await fetch(`${this.rustServerUrl}/sessions/${sessionId}`, {
        method: "DELETE",
      });
      console.log(`[Session ${sessionId}] Rust session deleted`);
    } catch (error: any) {
      console.error(`[Session ${sessionId}] Failed to delete Rust session:`, error.message);
    }
  }

  playAudio(channel: any, audioUrl: string) {
    channel.play({ media: `sound:${audioUrl}` }, (err: any, playback: any) => {
      console.log("Playing audio:", audioUrl);
      if (err) {
        console.error("Error playing audio:", err);
        return;
      } else {
        console.log("Audio played successfully");
      }
    });
  }

  addChannelToBridge(channel: any, bridge: any) {
    bridge.addChannel({ channel: channel.id }, (err: any) => {
      if (err) {
        console.error("Error adding channel to bridge:", err);
        return;
      } else {
        console.log("Channel added to bridge successfully: " + channel.name);
        this.emit("channelAddedToBridge", channel);
      }
    });
  }

  async registerOutgoingCallUsage(
    fromNumber: string,
    recipient: string,
    callStartTime: string,
    callEndTime: string,
    date: string
  ) {
    console.log("callStartTime:", callStartTime);
    console.log("callEndTime:", callEndTime);
    console.log("phoneNumber:", fromNumber);
    console.log("recipient:", recipient);

    const usageUrl = process.env.CALL_USAGE_API_URL || "http://127.0.0.1:8001/api/v1/call-usage/";
    fetch(usageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start_time: callStartTime,
        end_time: callEndTime,
        from_number: fromNumber,
        recipient: recipient,
        date: date,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        console.log("Success:", data);
      })
      .catch((error) => {
        console.error("Error:", error);
      });
  }

  /**
   * Handle actions from the dashboard UI (hang up, transfer)
   */
  handleDashboardAction(action: string, data: any) {
    if (action === "hangup") {
      const session = this.sessionManager.getSession(data.sessionId);
      if (session) {
        console.log(`[Dashboard] Hanging up session ${data.sessionId}`);
        this.sessionMessageHandlers.delete(session.id);
        this.sessionSpeechState.delete(session.id);
        this.deleteRustSession(session.id);
        if (this.dashboard) this.dashboard.emitCallEnded(session.id);
        if (this.callHistory) this.callHistory.endCall(session.id);
        this.sessionManager.endSession(session.id);
      }
    } else if (action === "transfer") {
      const session = this.sessionManager.getSession(data.sessionId);
      if (session) {
        console.log(`[Dashboard] Transferring ${data.sessionId} → ${data.endpoint}`);
        this.initiateOutgoingCall(session, session.incomingChannel, data.endpoint);
        this.sessionMessageHandlers.delete(session.id);
        this.sessionSpeechState.delete(session.id);
        this.deleteRustSession(session.id);
      }
    } else if (action === "openclawSpeak") {
      // OpenClaw plugin sent a "speak" command — find the session's assistant
      const session = this.sessionManager.getSession(data.callId);
      if (session) {
        const assistant = this.sessionManager.getAssistant(session.id);
        if (assistant && typeof assistant.onOpenClawSpeak === "function") {
          assistant.onOpenClawSpeak(data.text);
        }
      }
    } else if (action === "openclawDial") {
      // OpenClaw wants to initiate an outbound call
      console.log(`[Controller] OpenClaw dial request to: ${data.to}`);
      // TODO: Implement outbound dialing for OpenClaw (originate call + assign OpenClaw assistant)
    } else if (action === "reconnectAri") {
      console.log("[Dashboard] Manual ARI reconnect requested");
      if (this.dashboard) this.dashboard.updateServiceStatus("asterisk", "connecting", "Reconnecting...");
      try { if (this.client?._ws) this.client._ws.close(); } catch { }
      if (this.ariReconnectTimer) { clearTimeout(this.ariReconnectTimer); this.ariReconnectTimer = null; }
      this.connectARI().then(async () => {
        this.startARILoop();
        if (this.dashboard) this.dashboard.updateServiceStatus("asterisk", "connected", this.pbxIP);
        console.log("[Dashboard] Manual ARI reconnect succeeded");
        await this.reconcileSessions();
      }).catch((err: any) => {
        console.error(`[Dashboard] Manual ARI reconnect failed: ${err.message}`);
      });
    } else if (action === "reconnectTranscription") {
      console.log("[Dashboard] Manual transcription reconnect requested");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("transcription", "connecting", "Reconnecting...");
        if (this.useRustRtp) this.dashboard.updateServiceStatus("rustRtp", "connecting", "Reconnecting...");
      }
      try { if (this.ws) this.ws.close(); } catch { }
      if (this.transcriptionReconnectTimer) { clearTimeout(this.transcriptionReconnectTimer); this.transcriptionReconnectTimer = null; }
      this.connectTranscriptionWS();
    } else if (action === "reconnectTts") {
      console.log("[Dashboard] Manual TTS reconnect requested");
      this.reconnectTTS();
    }
  }

  getClient(): any {
    return this.client;
  }

  async close() {
    console.log("Closing AriControllerServer...");

    // Persist call end to history for all active sessions before destroying them
    if (this.callHistory) {
      for (const id of this.sessionManager.getActiveSessionIds()) {
        try { this.callHistory.endCall(id); } catch { }
      }
    }

    // End all active sessions gracefully
    try {
      await this.sessionManager.endAllSessions();
    } catch (err: any) {
      console.error("[Controller] Error ending sessions:", err.message);
    }

    // Clear message handlers
    this.sessionMessageHandlers.clear();
    this.sessionSpeechState.clear();

    // Cancel reconnect timers
    if (this.transcriptionReconnectTimer) {
      clearTimeout(this.transcriptionReconnectTimer);
      this.transcriptionReconnectTimer = null;
    }
    if (this.ariReconnectTimer) {
      clearTimeout(this.ariReconnectTimer);
      this.ariReconnectTimer = null;
    }

    // Close WebSocket
    if (this.ws) {
      try { this.ws.close(); } catch { }
      this.ws = null;
    }

    // Close TTS client
    if (this.ttsClient) {
      this.ttsClient.close();
      this.ttsClient = null;
    }

    this.emit("close");
  }
}

module.exports.AriControllerServer = AriControllerServer;
export { };

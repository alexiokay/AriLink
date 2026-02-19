const util = require("util");
const ari = require("ari-client");
const EventEmitter = require("events");
const WebSocket = require("ws");
const moment = require("moment");

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const {
  CallSessionManager,
  sessionManager,
} = require("./CallSession");
const { AssistantFactory } = require("./AssistantFactory");
const { TtsClient } = require("./TtsClient");

// Type definition for CallSessionData (inline since we can't import types with require)
interface CallSessionData {
  id: string;
  bridge: any;
  incomingChannel: any;
  outgoingChannel?: any;
  externalMediaChannelId?: string;
  assistant?: any;
  callerName?: string;
  startTime: Date;
  status: "pending" | "active" | "ended";
  noMatchCount: number;
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
      const bridge = await this.client.bridges.create({ type: "mixing" });
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
    this.client.on("StasisStart", this.stasisStart.bind(this));
    this.client.on("StasisEnd", this.stasisEnd.bind(this));
    this.client.on("ChannelDtmfReceived", this.dtmfReceived.bind(this));

    const appName = process.env.STASIS_APP_NAME || "stasis-app";
    console.log(`Starting ARI application: ${appName}`);
    this.client.start(appName);
  }

  connectTranscriptionWS() {
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

      // Try to parse message with session ID, or broadcast to all handlers
      let parsedMessage: any;
      try {
        parsedMessage = JSON.parse(raw);
      } catch {
        // Plain text message - route to all active handlers
        parsedMessage = { text: raw };
      }

      // Forward to dashboard + persist
      if (parsedMessage.text) {
        const isFinal = parsedMessage.is_final || parsedMessage.isFinal || false;
        const sessionId = parsedMessage.sessionId || "";

        if (this.dashboard) {
          // First transcription proves the full pipeline is working
          if (this.useRustRtp) {
            this.dashboard.updateServiceStatus("transcription", "connected", process.env.TRANSCRIPTION_SERVICES || "via Rust");
          }
          this.dashboard.emitTranscription({ sessionId, text: parsedMessage.text, is_final: isFinal });
        }

        // Persist only final transcriptions to avoid DB bloat
        if (this.callHistory && isFinal && sessionId) {
          try {
            this.callHistory.saveTranscription({
              callId: sessionId,
              text: parsedMessage.text,
              isFinal: true,
              timestamp: new Date().toISOString(),
            });
          } catch (err: any) {
            console.error(`[CallHistory] Failed to save transcription for ${sessionId}:`, err.message);
          }
        }
      }

      // If message has sessionId, route to specific handler
      if (parsedMessage.sessionId) {
        const handler = this.sessionMessageHandlers.get(parsedMessage.sessionId);
        if (handler) {
          handler(parsedMessage);
        }
      } else {
        // Broadcast to all handlers (fallback for non-tagged messages)
        for (const handler of this.sessionMessageHandlers.values()) {
          handler({ text: raw });
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
   * Connect to the TTS service (Kokoro) for text-to-speech synthesis.
   */
  connectTTS() {
    const ttsUrl = process.env.TTS_SERVICE;
    if (!ttsUrl) {
      console.log("[Controller] TTS_SERVICE not configured — text-to-speech disabled");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("tts", "disabled", "TTS_SERVICE not set");
      }
      return;
    }

    console.log(`[Controller] Connecting TTS: ${ttsUrl}`);
    this.ttsClient = new TtsClient(ttsUrl, {
      voice: process.env.TTS_VOICE,
      speed: parseFloat(process.env.TTS_SPEED || "1.0"),
    });

    this.ttsClient.on("connected", () => {
      console.log("[Controller] TTS service connected");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("tts", "connected", ttsUrl);
      }
    });

    this.ttsClient.on("disconnected", () => {
      console.log("[Controller] TTS service disconnected");
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("tts", "disconnected");
      }
    });

    this.ttsClient.on("error", (err: any) => {
      console.error(`[Controller] TTS error: ${err.message || err}`);
      if (this.dashboard) {
        this.dashboard.updateServiceStatus("tts", "error", err.message || "Connection failed");
      }
    });

    this.ttsClient.connect();
  }

  /**
   * Synthesize text and play it on a channel via Asterisk.
   * Returns a promise that resolves when playback finishes.
   */
  async speakOnChannel(
    sessionId: string,
    channel: any,
    text: string,
    assistant?: any
  ): Promise<void> {
    if (!this.ttsClient?.isConnected()) {
      console.error(`[Session ${sessionId}] TTS not connected — cannot speak`);
      if (assistant?.onSpeakingDone) assistant.onSpeakingDone();
      return;
    }

    try {
      // Synthesize text → temp slin16 file
      const filePath = await this.ttsClient.synthesize(sessionId, text);

      // Play via Asterisk (strip .sln16 extension — Asterisk auto-detects format)
      const soundPath = filePath.replace(/\.sln16$/, "");
      channel.play({ media: `sound:${soundPath}` }, (err: any, playback: any) => {
        if (err) {
          console.error(`[Session ${sessionId}] TTS playback error:`, err);
          TtsClient.cleanupFile(filePath);
          if (assistant?.onSpeakingDone) assistant.onSpeakingDone();
          return;
        }

        playback.once("PlaybackFinished", () => {
          console.log(`[Session ${sessionId}] TTS playback finished`);
          TtsClient.cleanupFile(filePath);
          if (assistant?.onSpeakingDone) assistant.onSpeakingDone();
        });
      });
    } catch (err: any) {
      console.error(`[Session ${sessionId}] TTS synthesis failed: ${err.message}`);
      if (assistant?.onSpeakingDone) assistant.onSpeakingDone();
    }
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
        try { this.playAudio(channel, "beep"); } catch {}
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
      // External media channel - find its session
      console.log("This is an external media channel");
      const session = this.sessionManager.getSessionByExternalMediaId(
        channel.id
      );
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
        try { this.playAudio(channel, "beep"); } catch {}
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

    // Create Rust RTP session (before ExternalMedia so it's ready to receive audio)
    await this.createRustSession(sessionId);

    // Create external media channel for transcription
    await this.createExternalMediaChannelForSession(sessionId);

    // Create assistant for this session
    // Priority: 1) Extension-based routing (config/routing.json)
    //           2) DEFAULT_ASSISTANT env var
    //           3) Auto-detect based on transfer config
    const extension = channel.dialplan?.exten || "unknown";
    const callerId = channel.caller?.number || "unknown";

    let assistant: any;
    const explicitAssistant = process.env.DEFAULT_ASSISTANT;
    if (explicitAssistant) {
      // Env var override — always use this assistant
      assistant = AssistantFactory.createByType(
        explicitAssistant, this.client, sessionId, this.contacts
      );
    } else {
      // Use extension-based routing (config/routing.json)
      assistant = AssistantFactory.createFromExtension(
        extension, this.client, sessionId, this.contacts
      );
    }
    const assistantType = assistant.getConfig().name;

    console.log(`[Session ${sessionId}] Using assistant: ${assistantType} (${assistant.config.name})`);

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
      assistantName: assistant.config?.name || assistantType,
      startTime: new Date().toISOString(),
      status: "active",
    };
    if (this.dashboard) {
      this.dashboard.emitCallUpdate(callData);
    }
    if (this.callHistory) {
      this.callHistory.saveCall(callData);
    }

    // Let the assistant handle call start (plays welcome, sets state)
    await assistant.onCallStart(channel, callerId, extension);
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

    // Create Rust RTP session + ExternalMedia channel (audio pipeline)
    await this.createRustSession(sessionId);
    await this.createExternalMediaChannelForSession(sessionId);

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
      assistantName: assistant.config?.name || assistantSlug,
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
      const text = message.text || message.data || message;
      const isFinal = message.is_final || message.isFinal || false;
      console.log(`[Session ${sessionId}] Received transcription: ${text}`);

      const assistant = this.sessionManager.getAssistant(sessionId);
      if (assistant) {
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
      this.deleteRustSession(sessionId);
    });

    // Broadcast assistant state changes to dashboard
    assistant.on("stateChange", (data: { sessionId: string; prev: string; state: string }) => {
      if (this.dashboard) {
        this.dashboard.emitAssistantState(data);
      }
    });

    // Handle generic transfer request
    assistant.on("transfer", async (data: { endpoint: string; sessionId: string }) => {
      console.log(`[Session ${sessionId}] Transfer requested to: ${data.endpoint}`);
      this.initiateOutgoingCall(session, channel, data.endpoint);
      this.sessionMessageHandlers.delete(sessionId);
      this.deleteRustSession(sessionId);
    });

    // ── OpenClaw-specific events ──

    // Forward transcriptions to connected OpenClaw plugin instances
    assistant.on("openclawTranscription", (data: { callId: string; text: string; isFinal: boolean; callerNumber?: string }) => {
      if (this.dashboard?.hasOpenClawClients()) {
        this.dashboard.emitOpenClawTranscription(data);
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
    assistant.on("openclawCallEnded", (data: { callId: string; reason?: string }) => {
      if (this.dashboard?.hasOpenClawClients()) {
        this.dashboard.emitOpenClawCallEnded(data);
      }
    });

    // OpenClaw wants to speak to the caller via TTS
    assistant.on("openclawSpeak", (data: { sessionId: string; text: string }) => {
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
          throw err;
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

          outChannel.play(
            { media: "sound:custom/welcome_2" },
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
          const callEndTime = moment()
            .add(1, "hour")
            .format("YYYY-MM-DD HH:mm:ss");
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
    const format = "slin16";
    const username = process.env.ASTERISK_LOGIN;
    const password = process.env.ASTERISK_PASSWORD;
    const port = parseInt(process.env.RTP_LISTEN_PORT || "8000", 10);

    const url = `${ariEndpoint}/channels/externalMedia?app=${appName}&external_host=${externalHost}%3A${port}&format=${format}`;

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
      }
    } catch (error: any) {
      console.error(
        `[Session ${sessionId}] Error creating ExternalMedia channel:`,
        error.message
      );
    }
  }

  /**
   * Create a session on the Rust RTP server (only when USE_RUST_RTP is active)
   */
  async createRustSession(sessionId: string): Promise<void> {
    if (!this.useRustRtp) return;

    const transcriptionServices = (process.env.TRANSCRIPTION_SERVICES || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    try {
      const response = await fetch(`${this.rustServerUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          codec: "slin16",
          transcription_services: transcriptionServices,
        }),
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

    fetch("http://127.0.0.1:8001/api/v1/call-usage/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start_time: callStartTime,
        end_time: callEndTime,
        from_number: fromNumber,
        recipent: recipient,
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
      try { if (this.client?._ws) this.client._ws.close(); } catch {}
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
      try { if (this.ws) this.ws.close(); } catch {}
      if (this.transcriptionReconnectTimer) { clearTimeout(this.transcriptionReconnectTimer); this.transcriptionReconnectTimer = null; }
      this.connectTranscriptionWS();
    }
  }

  getClient(): any {
    return this.client;
  }

  async close() {
    console.log("Closing AriControllerServer...");

    // End all active sessions gracefully
    try {
      await this.sessionManager.endAllSessions();
    } catch (err: any) {
      console.error("[Controller] Error ending sessions:", err.message);
    }

    // Clear message handlers
    this.sessionMessageHandlers.clear();

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
      try { this.ws.close(); } catch {}
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
export {};

const util = require("util");
const express = require("express");
const app = express();
const server = require("http").createServer(app);
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
  private accessKey: string;
  private secretKey: string;
  private client: any;
  private udpServer: any;
  private transcriptionServerIp: string;
  private transcriptionServerPort: string;
  private ws: any;
  private contacts: any;
  private sessionManager: InstanceType<typeof CallSessionManager>;
  private useRustRtp: boolean;
  private rustServerUrl: string | undefined;

  // Map to store per-session WebSocket message handlers
  private sessionMessageHandlers: Map<string, (message: any) => void> =
    new Map();

  constructor(pbxIP: string, accessKey: string, secretKey: string, rustServerUrl?: string) {
    super();
    this.pbxIP = pbxIP;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.client = null;

    this.udpServer = null;
    this.transcriptionServerIp = "0.0.0.0";
    this.transcriptionServerPort = "3044";

    this.useRustRtp = !!rustServerUrl;
    this.rustServerUrl = rustServerUrl;

    // Use the session manager for multi-call support
    this.sessionManager = sessionManager;
  }

  async start(contacts: any[]) {
    await this.connectARI();
    this.startARILoop();
    this.startWebServer();
    this.contacts = contacts;

    if (this.contacts) {
      console.log("Contact hash map:", this.contacts);
    } else {
      console.log("Failed to convert JSON file to hash map");
    }
  }

  async connectARI(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ariEndpoint = `http://${this.pbxIP}:8088`;

      ari.connect(
        ariEndpoint,
        process.env.ASTERISK_LOGIN,
        process.env.ASTERISK_PASSWORD,
        (err: any, client: any) => {
          if (err) {
            reject(err);
          } else {
            this.client = client;
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

  startWebServer() {
    const port = 3011;
    server.listen(port, () => {
      console.log(`Listening on *:${port}`);
    });

    app.use(express.static(__dirname + "/public"));
    app.get("/", (req: any, res: any) => {
      res.sendFile(__dirname + "/testPage.html");
    });

    console.log("Client connected");

    // Connect to either Rust RTP server or legacy Node.js transcription server
    const wsUrl = this.useRustRtp
      ? `${this.rustServerUrl!.replace(/^http/, "ws")}/ws`
      : `ws://${this.transcriptionServerIp}:${this.transcriptionServerPort}`;

    console.log(`[Controller] Connecting WebSocket to: ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log(`WebSocket connection established (${this.useRustRtp ? "Rust RTP" : "Node.js transcriber"})`);
    };

    // Central message router - routes transcriptions to the correct session handler
    this.ws.onmessage = (message: any) => {
      console.log("Received transcription:", message.data);

      // Try to parse message with session ID, or broadcast to all handlers
      let parsedMessage: any;
      try {
        parsedMessage = JSON.parse(message.data);
      } catch {
        // Plain text message - route to all active handlers
        parsedMessage = { text: message.data };
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
          handler({ text: message.data });
        }
      }
    };

    this.ws.onclose = () => {
      console.log("WebSocket connection to AriTranscriber server closed");
    };
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

    if (dialed) {
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
      await this.handleIncomingCall(channel);
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
    // Auto-select: use direct-dial if DEFAULT_ASSISTANT not set and transfer destination not configured
    let assistantType = process.env.DEFAULT_ASSISTANT;
    if (!assistantType) {
      const hasTransferDest = process.env.TRANSFER_DESTINATION && process.env.TRANSFER_TRUNK;
      assistantType = hasTransferDest ? "ivr-transfer" : "direct-dial";
      console.log(`[Session ${sessionId}] Auto-selected assistant: ${assistantType} (transfer destination ${hasTransferDest ? "configured" : "not configured"})`);
    }

    const assistant = AssistantFactory.createByType(
      assistantType,
      this.client,
      sessionId,
      this.contacts
    );

    console.log(`[Session ${sessionId}] Using assistant: ${assistantType} (${assistant.config.name})`);

    // Store assistant in session
    this.sessionManager.setAssistant(sessionId, assistant);

    // Listen for assistant events
    this.setupAssistantEventHandlers(session, assistant, channel);

    // Set up session-specific transcription handler (routes to assistant)
    this.setupSessionTranscriptionHandler(session);

    // Let the assistant handle call start (plays welcome, sets state)
    const callerId = channel.caller?.number || "unknown";
    const extension = channel.dialplan?.exten || "unknown";
    await assistant.onCallStart(channel, callerId, extension);
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

    // Handle generic transfer request
    assistant.on("transfer", async (data: { endpoint: string; sessionId: string }) => {
      console.log(`[Session ${sessionId}] Transfer requested to: ${data.endpoint}`);
      this.initiateOutgoingCall(session, channel, data.endpoint);
      this.sessionMessageHandlers.delete(sessionId);
      this.deleteRustSession(sessionId);
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
    const sipProvider = process.env.SIP_PROVIDER;
    const appName = process.env.STASIS_APP_NAME || "stasis-app";

    const outgoingChannelParams = {
      endpoint: `Local/${recipient}@from-internal`,
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

  getClient(): any {
    return this.client;
  }

  async close() {
    console.log("Closing AriControllerServer...");

    // End all active sessions gracefully
    await this.sessionManager.endAllSessions();

    // Clear message handlers
    this.sessionMessageHandlers.clear();

    this.emit("close");
  }
}

module.exports.AriControllerServer = AriControllerServer;
export {};

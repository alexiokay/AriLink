const {
  sessionManager: dashSessionManager,
} = require("./CallSession");

class DashboardServer {
  private io: any;
  private config: Record<string, any> = {};
  private actionHandler: ((action: string, data: any) => void) | null = null;
  private getAriClient: (() => any) | null = null;
  private campaignDialer: any | null = null;
  private lastCampaignStatus: any | null = null;
  private logCollector: any | null = null;
  private callHistory: any | null = null;

  // OpenClaw integration — track connected OpenClaw plugin instances
  private openclawSockets: Set<string> = new Set();

  // Live service state — updated by AriControllerServer
  private serviceState: Record<string, any> = {
    asterisk: { label: "Asterisk", status: "connecting", detail: "" },
    rustRtp: { label: "Rust RTP", status: "unknown", detail: "" },
    transcription: { label: "Transcription", status: "unknown", detail: "" },
  };

  constructor(
    io: any,
    actionHandler?: (action: string, data: any) => void,
    ariClientGetter?: () => any,
    callHistory?: any
  ) {
    this.io = io; // Socket.IO server instance (created by Nitro plugin)

    this.actionHandler = actionHandler || null;
    this.getAriClient = ariClientGetter || null;
    this.callHistory = callHistory || null;
    this.config = this.gatherConfig();
    this.initServiceState();

    // Set up log collector — must be installed before setupSocketHandlers
    // so that log messages from setup are captured
    const { LogCollector } = require("./LogCollector");
    this.logCollector = new LogCollector({ maxBufferSize: 5000 });
    this.logCollector.onEntry((entry: any) => {
      this.io.emit("dashboard:log", entry);
    });
    this.logCollector.install();

    this.setupSocketHandlers();

    console.log("[Dashboard] Socket.IO ready");
  }

  private gatherConfig(): Record<string, any> {
    return {
      assistant: process.env.DEFAULT_ASSISTANT || "ivr-transfer",
      pbxIP: process.env.PBX_IP || "",
      useRustRtp: process.env.USE_RUST_RTP === "true",
      rustServerUrl: process.env.RUST_SERVER_URL || "http://localhost:9900",
      transcriptionServices: process.env.TRANSCRIPTION_SERVICES || "",
      stasisApp: process.env.STASIS_APP_NAME || "stasis-app",
    };
  }

  private initServiceState() {
    const useRust = process.env.USE_RUST_RTP === "true";
    this.serviceState = {
      asterisk: {
        label: "Asterisk",
        status: "connecting",
        detail: process.env.PBX_IP || "not configured",
      },
      rustRtp: {
        label: "Rust RTP",
        status: useRust ? "connecting" : "disabled",
        detail: useRust ? (process.env.RUST_SERVER_URL || "http://localhost:9900") : "USE_RUST_RTP not set",
      },
      transcription: {
        label: "Transcription",
        status: "connecting",
        detail: process.env.TRANSCRIPTION_SERVICES || "not configured",
      },
    };
  }

  private getCampaignStatusPayload(): any {
    if (this.campaignDialer) {
      return this.campaignDialer.getStatus();
    }
    if (this.lastCampaignStatus) {
      return this.lastCampaignStatus;
    }
    return { status: "idle", progress: 0, total: 0, activeCalls: 0, results: [] };
  }

  private setupSocketHandlers() {
    this.io.on("connection", (socket: any) => {
      console.log(`[Dashboard] Client connected: ${socket.id}`);

      // Send current state immediately on connect
      socket.emit("dashboard:config", this.config);
      socket.emit("dashboard:calls", this.getActiveCalls());
      socket.emit("dashboard:services", this.serviceState);
      socket.emit("dashboard:campaignStatus", this.getCampaignStatusPayload());

      // Also respond to explicit requests
      socket.on("dashboard:getState", () => {
        socket.emit("dashboard:config", this.config);
        socket.emit("dashboard:calls", this.getActiveCalls());
        socket.emit("dashboard:services", this.serviceState);
        socket.emit("dashboard:campaignStatus", this.getCampaignStatusPayload());
      });

      socket.on("dashboard:refreshState", () => {
        socket.emit("dashboard:config", this.config);
        socket.emit("dashboard:calls", this.getActiveCalls());
        socket.emit("dashboard:services", this.serviceState);
        socket.emit("dashboard:campaignStatus", this.getCampaignStatusPayload());
      });

      socket.on("dashboard:setAssistant", (data: { assistant: string }) => {
        if (data?.assistant) {
          process.env.DEFAULT_ASSISTANT = data.assistant;
          this.config.assistant = data.assistant;
          console.log(`[Dashboard] Assistant changed to: ${data.assistant}`);
          this.io.emit("dashboard:config", this.config);
        }
      });

      // Call control actions — forwarded to AriControllerServer
      socket.on("dashboard:hangup", (data: { sessionId: string }) => {
        if (data?.sessionId && this.actionHandler) {
          console.log(`[Dashboard] Hangup requested for ${data.sessionId}`);
          this.actionHandler("hangup", data);
        }
      });

      socket.on("dashboard:transfer", (data: { sessionId: string; endpoint: string }) => {
        if (data?.sessionId && data?.endpoint && this.actionHandler) {
          console.log(`[Dashboard] Transfer requested: ${data.sessionId} → ${data.endpoint}`);
          this.actionHandler("transfer", data);
        }
      });

      // ── Service control ──

      socket.on("dashboard:reconnectAri", () => {
        if (this.actionHandler) {
          console.log("[Dashboard] Reconnect ARI requested");
          this.actionHandler("reconnectAri", {});
        }
      });

      socket.on("dashboard:reconnectTranscription", () => {
        if (this.actionHandler) {
          console.log("[Dashboard] Reconnect transcription requested");
          this.actionHandler("reconnectTranscription", {});
        }
      });

      socket.on("dashboard:restartParakeet", () => {
        if (this.actionHandler) {
          console.log("[Dashboard] Restart Parakeet requested");
          this.actionHandler("restartParakeet", {});
        }
      });

      // ── Campaign control ──

      socket.on("dashboard:campaignStart", (data: { phoneList: { phone: string; name?: string }[]; name?: string; assistantSlug?: string; maxConcurrent?: number; callerId?: string }) => {
        if (!data?.phoneList || !Array.isArray(data.phoneList) || data.phoneList.length === 0) {
          socket.emit("dashboard:campaignError", { message: "Phone list is empty or invalid" });
          return;
        }

        if (this.campaignDialer) {
          socket.emit("dashboard:campaignError", { message: "A campaign is already running" });
          return;
        }

        const client = this.getAriClient ? this.getAriClient() : null;
        if (!client) {
          socket.emit("dashboard:campaignError", { message: "ARI client not connected" });
          return;
        }

        console.log(`[Dashboard] Starting campaign "${data.name || "unnamed"}" with ${data.phoneList.length} numbers, assistant: ${data.assistantSlug || "auto-dialer-call"}`);

        this.lastCampaignStatus = null;
        const { AutoDialer } = require("./AutoDialer");
        this.campaignDialer = new AutoDialer(client, {
          name: data.name,
          assistantSlug: data.assistantSlug,
          maxConcurrent: data.maxConcurrent,
          callerId: data.callerId,
        });
        this.campaignDialer.setPhoneList(data.phoneList);

        // Wire AutoDialer events to broadcast to all dashboard clients
        // (call updates, transcription, and audio pipeline are handled by
        //  AriControllerServer.handleCampaignCall via the global stasisStart)

        this.campaignDialer.on("campaignStarted", () => {
          this.io.emit("dashboard:campaignStatus", this.getCampaignStatusPayload());
        });

        this.campaignDialer.on("campaignPaused", () => {
          this.io.emit("dashboard:campaignStatus", this.getCampaignStatusPayload());
        });

        this.campaignDialer.on("campaignResumed", () => {
          this.io.emit("dashboard:campaignStatus", this.getCampaignStatusPayload());
        });

        this.campaignDialer.on("callCompleted", (result: any) => {
          this.io.emit("dashboard:campaignCallResult", result);
          this.io.emit("dashboard:campaignStatus", this.getCampaignStatusPayload());
        });

        this.campaignDialer.on("campaignComplete", () => {
          this.lastCampaignStatus = this.campaignDialer.getStatus();
          this.io.emit("dashboard:campaignStatus", this.lastCampaignStatus);
          this.campaignDialer = null; // Allow new campaign
        });

        this.campaignDialer.start();
      });

      socket.on("dashboard:campaignPause", () => {
        if (this.campaignDialer) {
          this.campaignDialer.pause();
        }
      });

      socket.on("dashboard:campaignResume", () => {
        if (this.campaignDialer) {
          this.campaignDialer.resume();
        }
      });

      socket.on("dashboard:campaignStop", () => {
        if (this.campaignDialer) {
          this.lastCampaignStatus = this.campaignDialer.getStatus();
          this.lastCampaignStatus.status = "completed";
          this.campaignDialer.stop();
          this.campaignDialer = null;
        }
        this.io.emit("dashboard:campaignStatus", this.getCampaignStatusPayload());
      });

      socket.on("dashboard:getCampaignStatus", () => {
        socket.emit("dashboard:campaignStatus", this.getCampaignStatusPayload());
      });

      // ── Logs ──

      socket.on("dashboard:getLogs", (data: { limit?: number; before?: number }) => {
        if (this.logCollector) {
          const limit = data?.limit || 100;
          const before = data?.before;
          const entries = this.logCollector.getEntries(limit, before);
          socket.emit("dashboard:logs", { entries, total: this.logCollector.getCount() });
        }
      });

      // ── Auto-Configure (Pro Setup via SSH) ──

      socket.on("setup:auto-configure", async (data: any) => {
        console.log(`[Dashboard] Auto-configure requested by ${socket.id}`);
        try {
          const { autoConfigurePbx } = require("./AutoConfigure");
          const result = await autoConfigurePbx(data, (step: any) => {
            socket.emit("setup:auto-configure:progress", step);
          });
          socket.emit("setup:auto-configure:done", result);
        } catch (err: any) {
          const msg = err.code === "MODULE_NOT_FOUND"
            ? "Auto-configure module not available — this is a Pro Pack feature"
            : err.message;
          console.error("[Dashboard] Auto-configure error:", msg);
          socket.emit("setup:auto-configure:done", {
            success: false,
            steps: [{ id: "error", label: "Error", status: "failed", detail: msg }],
            env: {},
            error: msg,
          });
        }
      });

      // ── Terminals (multi-tab: any number of SSH / local sessions) ──

      const terminalSessions: Record<string, any> = {};

      socket.on("terminal:start", async (data?: any) => {
        const tabId = data?.tabId || data?.mode || "default";
        const type = data?.type || (tabId === "local" ? "local" : "remote");

        // Clean up existing session for this tab
        if (terminalSessions[tabId]) {
          try { terminalSessions[tabId].dispose(); } catch {}
          delete terminalSessions[tabId];
        }

        try {
          console.log(`[Dashboard] Starting ${type} terminal (${tabId}) for ${socket.id}`);

          if (type === "local") {
            const { LocalTerminal } = require("./LocalTerminal");
            terminalSessions[tabId] = new LocalTerminal(socket, tabId);
            await terminalSessions[tabId].connect();
          } else {
            const { SshTerminal } = require("./SshTerminal");
            terminalSessions[tabId] = new SshTerminal(socket, tabId);
            await terminalSessions[tabId].connect(data);
          }
        } catch (err: any) {
          console.error(`[Dashboard] Failed to start ${type} terminal (${tabId}): ${err.message}`);
          socket.emit("terminal:data", { mode: tabId, data: `\r\n*** ERROR: ${err.message} ***\r\n` });
          delete terminalSessions[tabId];
        }
      });

      socket.on("terminal:input", (data: any) => {
        if (typeof data === "string") {
          for (const session of Object.values(terminalSessions)) {
            session.write(data);
          }
        } else {
          const tabId = data.tabId || data.mode;
          const session = terminalSessions[tabId];
          if (session) session.write(data.input);
        }
      });

      socket.on("terminal:resize", (data: any) => {
        const tabId = data.tabId || data.mode;
        if (tabId) {
          const session = terminalSessions[tabId];
          if (session) session.resize(data.cols, data.rows);
        } else {
          for (const session of Object.values(terminalSessions)) {
            session.resize(data.cols, data.rows);
          }
        }
      });

      socket.on("terminal:stop", (data?: any) => {
        const tabId = data?.tabId || data?.mode;
        if (tabId && terminalSessions[tabId]) {
          console.log(`[Dashboard] Stopping terminal ${tabId} for ${socket.id}`);
          terminalSessions[tabId].dispose();
          delete terminalSessions[tabId];
        } else if (!tabId) {
          for (const [key, session] of Object.entries(terminalSessions)) {
            console.log(`[Dashboard] Stopping terminal ${key} for ${socket.id}`);
            try { (session as any).dispose(); } catch {}
            delete terminalSessions[key];
          }
        }
      });

      // ── OpenClaw Integration ──

      socket.on("openclaw:register", (data: any) => {
        this.openclawSockets.add(socket.id);
        socket.join("openclaw"); // Join room for targeted broadcasts
        console.log(`[OpenClaw] Plugin registered: ${socket.id}`, data);

        // Send current active calls to the newly connected OpenClaw instance
        const calls = this.getActiveCalls().filter(
          (c: any) => c.assistant === "openclaw" || c.assistant === "OpenClawAssistant"
        );
        if (calls.length > 0) {
          socket.emit("openclaw:status", {
            connected: true,
            activeCalls: calls.length,
          });
        }
      });

      socket.on("openclaw:speak", (data: { callId: string; text: string }, ack?: (res: any) => void) => {
        if (!data?.callId || !data?.text) {
          ack?.({ ok: false, error: "Missing callId or text" });
          return;
        }
        console.log(`[OpenClaw] Speak request for ${data.callId}: "${data.text.substring(0, 60)}..."`);
        if (this.actionHandler) {
          this.actionHandler("openclawSpeak", data);
        }
        ack?.({ ok: true });
      });

      socket.on("openclaw:initiate_call", (data: { to: string; message?: string }, ack?: (res: any) => void) => {
        if (!data?.to) {
          ack?.({ ok: false, error: "Missing 'to' number" });
          return;
        }
        console.log(`[OpenClaw] Initiate call to ${data.to}`);
        if (this.actionHandler) {
          this.actionHandler("openclawDial", data);
        }
        ack?.({ ok: true });
      });

      socket.on("openclaw:hangup", (data: { callId: string }, ack?: (res: any) => void) => {
        if (!data?.callId) {
          ack?.({ ok: false, error: "Missing callId" });
          return;
        }
        console.log(`[OpenClaw] Hangup request for ${data.callId}`);
        if (this.actionHandler) {
          this.actionHandler("hangup", { sessionId: data.callId });
        }
        ack?.({ ok: true });
      });

      socket.on("openclaw:transfer", (data: { callId: string; to: string }, ack?: (res: any) => void) => {
        if (!data?.callId || !data?.to) {
          ack?.({ ok: false, error: "Missing callId or to" });
          return;
        }
        console.log(`[OpenClaw] Transfer ${data.callId} → ${data.to}`);
        if (this.actionHandler) {
          this.actionHandler("transfer", { sessionId: data.callId, endpoint: data.to });
        }
        ack?.({ ok: true });
      });

      socket.on("openclaw:status", (data: { callId?: string }, ack?: (res: any) => void) => {
        const calls = this.getActiveCalls();
        if (data?.callId) {
          const call = calls.find((c: any) => c.id === data.callId);
          ack?.({ ok: true, call: call || null });
        } else {
          ack?.({ ok: true, activeCalls: calls.length, calls });
        }
      });

      // ── Disconnect ──

      socket.on("disconnect", () => {
        console.log(`[Dashboard] Client disconnected: ${socket.id}`);
        this.openclawSockets.delete(socket.id);
        for (const [key, session] of Object.entries(terminalSessions)) {
          try { (session as any).dispose(); } catch {}
          delete terminalSessions[key];
        }
      });
    });
  }

  private getActiveCalls(): any[] {
    const calls: any[] = [];
    for (const id of dashSessionManager.getActiveSessionIds()) {
      const session = dashSessionManager.getSession(id);
      if (session) {
        calls.push({
          id: session.id,
          callerId: (session as any).campaignCallerId || session.incomingChannel?.caller?.number || "unknown",
          callerName: (session as any).campaignCallerName || session.callerName || session.incomingChannel?.caller?.name || "",
          extension: (session as any).campaignPhone || session.incomingChannel?.dialplan?.exten || "",
          channelName: session.incomingChannel?.name || "",
          assistant: session.assistant?.type || process.env.DEFAULT_ASSISTANT || "",
          assistantName: session.assistant?.config?.name || session.assistant?.type || "",
          startTime: session.startTime?.toISOString() || new Date().toISOString(),
          status: session.status,
        });
      }
    }
    return calls;
  }

  // --- Public methods called by AriControllerServer ---

  /** Update a service's live status and broadcast to all dashboard clients */
  updateServiceStatus(service: string, status: string, detail?: string) {
    if (this.serviceState[service]) {
      this.serviceState[service].status = status;
      if (detail !== undefined) {
        this.serviceState[service].detail = detail;
      }
    }
    // Broadcast full service state to all clients
    this.io.emit("dashboard:services", this.serviceState);
  }

  emitCallUpdate(call: any) {
    this.io.emit("dashboard:callUpdate", call);
  }

  emitCallEnded(sessionId: string) {
    this.io.emit("dashboard:callUpdate", { id: sessionId, ended: true });
  }

  emitAssistantState(data: { sessionId: string; prev: string; state: string; detail?: string }) {
    const ts = Date.now();
    this.io.emit("dashboard:assistantState", { ...data, timestamp: ts });
    if (this.callHistory) {
      const detail = data.detail ? `${data.state}:${data.detail}` : data.state;
      this.callHistory.saveEvent({ callId: data.sessionId, type: "state", text: detail, timestamp: new Date(ts).toISOString() });
    }
  }

  emitDTMF(data: { sessionId: string; digit: string }) {
    const ts = Date.now();
    this.io.emit("dashboard:dtmf", { ...data, timestamp: ts });
    if (this.callHistory) {
      this.callHistory.saveEvent({ callId: data.sessionId, type: "dtmf", text: data.digit, timestamp: new Date(ts).toISOString() });
    }
  }

  emitTranscription(data: { sessionId: string; text: string; is_final: boolean }) {
    const ts = Date.now();
    this.io.emit("dashboard:transcription", { ...data, timestamp: ts });
    if (this.callHistory && data.is_final && data.text) {
      this.callHistory.saveEvent({ callId: data.sessionId, type: "transcription", text: data.text, timestamp: new Date(ts).toISOString() });
    }
  }

  // --- OpenClaw event emitters (called by AriControllerServer) ---

  /** Forward transcription to connected OpenClaw plugins */
  emitOpenClawTranscription(data: { callId: string; text: string; isFinal: boolean; callerNumber?: string }) {
    this.io.to("openclaw").emit("openclaw:transcription", data);
  }

  /** Notify OpenClaw that a new call has started */
  emitOpenClawCallStarted(data: { callId: string; number: string; direction: string }) {
    this.io.to("openclaw").emit("openclaw:call-started", data);
  }

  /** Notify OpenClaw that a call has ended */
  emitOpenClawCallEnded(data: { callId: string; reason?: string }) {
    this.io.to("openclaw").emit("openclaw:call-ended", data);
  }

  /** Check if any OpenClaw plugins are connected */
  hasOpenClawClients(): boolean {
    return this.openclawSockets.size > 0;
  }

  getIO() {
    return this.io;
  }
}

module.exports.DashboardServer = DashboardServer;
export {};

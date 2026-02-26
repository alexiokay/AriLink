import { io, type Socket } from "socket.io-client";

// Persist socket across Vite HMR reloads using the official HMR data API.
// Without this, each reload resets `socket` to null, creating zombie connections.
let socket: Socket | null = null;
if (import.meta.hot) {
  socket = import.meta.hot.data.socket ?? null;
  import.meta.hot.dispose((data) => { data.socket = socket; });
}

export function useSocket() {
  const connected = useState("socket-connected", () => false);
  const activeCalls = useState<any[]>("active-calls", () => []);
  const services = useState<Record<string, any>>("services", () => ({
    asterisk: { status: "unknown", label: "Asterisk" },
    rustRtp: { status: "unknown", label: "Rust RTP" },
    transcription: { status: "unknown", label: "Transcription" },
    tts: { status: "unknown", label: "TTS (Kokoro)" },
  }));
  const transcriptions = useState<any[]>("transcriptions", () => []);
  const serverConfig = useState<Record<string, any>>("server-config", () => ({}));
  const campaignStatus = useState<{
    status: string;
    progress: number;
    total: number;
    activeCalls: number;
    results: any[];
    name?: string;
    assistantSlug?: string;
  }>("campaign-status", () => ({
    status: "idle",
    progress: 0,
    total: 0,
    activeCalls: 0,
    results: [],
  }));
  const campaignResults = useState<any[]>("campaign-results", () => []);
  const logs = useState<any[]>("server-logs", () => []);
  const logsTotal = useState<number>("server-logs-total", () => 0);
  const assistantStates = useState<Record<string, { state: string; prev: string; timestamp: number }>>("assistant-states", () => ({}));
  const dtmfEvents = useState<any[]>("dtmf-events", () => []);
  // Per-call activity timeline: sessionId → array of {type, text, timestamp}
  const callActivity = useState<Record<string, { type: string; text: string; timestamp: number }[]>>("call-activity", () => ({}));

  function pushActivity(sessionId: string, type: string, text: string) {
    if (!callActivity.value[sessionId]) callActivity.value[sessionId] = [];
    callActivity.value[sessionId].push({ type, text, timestamp: Date.now() });
  }

  function cleanupCallData(sessionId: string) {
    delete assistantStates.value[sessionId];
    delete callActivity.value[sessionId];
    dtmfEvents.value = dtmfEvents.value.filter((d: any) => d.sessionId !== sessionId);
    transcriptions.value = transcriptions.value.filter((t: any) => t.sessionId !== sessionId);
  }

  function connect() {
    if (socket) return; // Already created (connecting or connected)

    // Always same origin — Nitro serves both the SPA and Socket.IO
    const url = window.location.origin;

    socket = io(url, {
      transports: ["polling", "websocket"],
    });

    socket.on("connect", () => {
      connected.value = true;
      // Request initial state
      socket!.emit("dashboard:getState");
    });

    socket.on("disconnect", () => {
      connected.value = false;
      // Reset all service statuses — backend is unreachable
      services.value = {
        asterisk: { status: "disconnected", label: "Asterisk", detail: "Server offline" },
        rustRtp: { status: "disconnected", label: "Rust RTP", detail: "Server offline" },
        transcription: { status: "disconnected", label: "Transcription", detail: "Server offline" },
        tts: { status: "disconnected", label: "TTS (Kokoro)", detail: "Server offline" },
      };
      activeCalls.value = [];
      campaignStatus.value = { status: "idle", progress: 0, total: 0, activeCalls: 0, results: [] };
      campaignResults.value = [];
    });

    // Auth rejection — stop reconnecting and redirect to login
    socket.on("connect_error", (err: Error) => {
      if (err.message === "Authentication required") {
        socket?.disconnect();
        socket = null;
        navigateTo("/login");
      }
    });

    // Service health updates
    socket.on("dashboard:services", (data: Record<string, any>) => {
      services.value = data;
    });

    // Active calls list (full sync from server — replaces everything)
    socket.on("dashboard:calls", (data: any[]) => {
      const newIds = new Set(data.map((c: any) => c.id));
      // Clean up data for calls that are no longer active
      for (const oldCall of activeCalls.value) {
        if (!newIds.has(oldCall.id)) {
          cleanupCallData(oldCall.id);
        }
      }
      activeCalls.value = data;
    });

    // Single call update (new/updated/ended)
    socket.on("dashboard:callUpdate", (data: any) => {
      const idx = activeCalls.value.findIndex((c) => c.id === data.id);
      if (data.ended) {
        if (idx >= 0) activeCalls.value.splice(idx, 1);
        cleanupCallData(data.id);
      } else if (idx >= 0) {
        activeCalls.value[idx] = data;
      } else {
        activeCalls.value.push(data);
      }
    });

    // Live transcription events
    socket.on("dashboard:transcription", (data: any) => {
      transcriptions.value.unshift(data);
      if (transcriptions.value.length > 200) transcriptions.value.length = 200;
      if (data.is_final && data.text) {
        pushActivity(data.sessionId, "transcription", data.text);
      }
    });

    // Assistant/TTS spoke to the caller
    socket.on("dashboard:spoken", (data: any) => {
      if (data.text) {
        pushActivity(data.sessionId, "spoken", data.text);
      }
    });

    // Server config
    socket.on("dashboard:config", (data: Record<string, any>) => {
      serverConfig.value = data;
    });

    // Campaign status updates
    socket.on("dashboard:campaignStatus", (data: any) => {
      campaignStatus.value = data;
    });

    // Individual call result
    socket.on("dashboard:campaignCallResult", (data: any) => {
      campaignResults.value.unshift(data);
    });

    // Campaign error
    socket.on("dashboard:campaignError", (data: any) => {
      console.error("[Campaign]", data.message);
    });

    // Assistant state changes (live call flow visibility)
    socket.on("dashboard:assistantState", (data: any) => {
      assistantStates.value[data.sessionId] = { state: data.state, prev: data.prev, timestamp: data.timestamp };
      const detail = data.detail ? `${data.state}:${data.detail}` : data.state;
      pushActivity(data.sessionId, "state", detail);
    });

    // DTMF digit pressed
    socket.on("dashboard:dtmf", (data: any) => {
      dtmfEvents.value.unshift(data);
      if (dtmfEvents.value.length > 100) dtmfEvents.value.length = 100;
      pushActivity(data.sessionId, "dtmf", data.digit);
    });

    // Real-time log entry
    socket.on("dashboard:log", (entry: any) => {
      logs.value.unshift(entry);
    });

    // Paginated log response
    socket.on("dashboard:logs", (data: { entries: any[]; total: number }) => {
      // Append older entries (they come newest-first, append at end)
      const existingIds = new Set(logs.value.map((l: any) => l.id));
      const newEntries = data.entries.filter((e: any) => !existingIds.has(e.id));
      logs.value.push(...newEntries);
      logsTotal.value = data.total;
    });
  }

  function disconnect() {
    socket?.disconnect();
    socket = null;
    connected.value = false;
  }

  function emit(event: string, data?: any) {
    socket?.emit(event, data);
  }

  function on(event: string, callback: (...args: any[]) => void) {
    socket?.on(event, callback);
  }

  function off(event: string, callback: (...args: any[]) => void) {
    socket?.off(event, callback);
  }

  // Auto-connect when used in the browser
  if (import.meta.client) {
    connect();
  }

  return {
    connected,
    activeCalls,
    services,
    transcriptions,
    serverConfig,
    campaignStatus,
    campaignResults,
    logs,
    logsTotal,
    assistantStates,
    dtmfEvents,
    callActivity,
    connect,
    disconnect,
    emit,
    on,
    off,
  };
}

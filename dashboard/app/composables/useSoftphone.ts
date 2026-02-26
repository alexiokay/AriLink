import {
  UserAgent,
  Registerer,
  Inviter,
  SessionState,
  RegistererState,
  type Invitation,
  type Session,
  type UserAgentOptions,
} from "sip.js";

// ── Types ──

export type RegState = "unregistered" | "registering" | "registered" | "error";
export type CallState = "idle" | "ringing-in" | "ringing-out" | "connected" | "holding";

export interface SipAccount {
  extension: string;
  password: string;
  label: string;
}

interface SoftphoneConfig {
  configured: boolean;
  error: string;
  wsUrl: string;
  domain: string;
  stunServer: string;
  codecs: string[];
  accounts: SipAccount[];
}

// ── HMR-persistent singletons (same pattern as useSocket.ts) ──

let ua: UserAgent | null = null;
let registerer: Registerer | null = null;
let currentSession: Session | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
const RECONNECT_BASE_DELAY = 2000; // 2s, doubles each attempt up to ~30s

if (import.meta.hot) {
  ua = import.meta.hot.data.ua ?? null;
  registerer = import.meta.hot.data.registerer ?? null;
  currentSession = import.meta.hot.data.currentSession ?? null;
  import.meta.hot.dispose((data) => {
    data.ua = ua;
    data.registerer = registerer;
    data.currentSession = currentSession;
    if (reconnectTimer) clearTimeout(reconnectTimer);
  });
}

// ── Hidden audio element for remote audio playback ──

function getRemoteAudio(): HTMLAudioElement {
  let el = document.getElementById("softphone-remote-audio") as HTMLAudioElement;
  if (!el) {
    el = document.createElement("audio");
    el.id = "softphone-remote-audio";
    el.autoplay = true;
    document.body.appendChild(el);
  }
  return el;
}

// ── Extract caller number from SIP URI ──

function extractNumber(uri: any): string {
  try {
    const str = uri?.toString?.() || "";
    const match = str.match(/sip:([^@]+)@/);
    return match?.[1] || str;
  } catch {
    return "Unknown";
  }
}

// ── SDP codec reordering ──

function reorderSdpCodecs(sdp: string, preferred: string[]): string {
  const lines = sdp.split("\r\n");
  const audioIdx = lines.findIndex((l) => l.startsWith("m=audio"));
  if (audioIdx < 0) return sdp;

  // Build payload-type → codec-name map from a=rtpmap lines
  const ptToName = new Map<number, string>();
  for (const line of lines) {
    const m = line.match(/^a=rtpmap:(\d+)\s+([^/]+)/);
    if (m) ptToName.set(Number(m[1]), m[2]!.toUpperCase());
  }

  // Parse m=audio line: m=audio PORT PROTO PT1 PT2 ...
  const parts = lines[audioIdx]!.split(" ");
  const header = parts.slice(0, 3);
  const pts = parts.slice(3).map(Number);

  // Sort: preferred codecs first (in user's order), rest keep original order
  const sorted = [...pts].sort((a, b) => {
    const iA = preferred.indexOf(ptToName.get(a) || "");
    const iB = preferred.indexOf(ptToName.get(b) || "");
    if (iA >= 0 && iB >= 0) return iA - iB;
    if (iA >= 0) return -1;
    if (iB >= 0) return 1;
    return 0;
  });

  lines[audioIdx] = [...header, ...sorted.map(String)].join(" ");
  return lines.join("\r\n");
}

function buildCodecModifier(codecs: string[]) {
  if (!codecs.length) return undefined;
  const upper = codecs.map((c) => c.toUpperCase());
  return async (desc: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
    if (!desc.sdp) return desc;
    desc.sdp = reorderSdpCodecs(desc.sdp, upper);
    return desc;
  };
}

// ── Composable ──

export function useSoftphone() {
  const regState = useState<RegState>("softphone-reg", () => "unregistered");
  const regError = useState<string>("softphone-reg-error", () => "");
  const callState = useState<CallState>("softphone-call-state", () => "idle");
  const callDirection = useState<"inbound" | "outbound" | null>("softphone-call-dir", () => null);
  const remoteNumber = useState<string>("softphone-remote", () => "");
  const callStartTime = useState<number | null>("softphone-call-start", () => null);
  const isMuted = useState<boolean>("softphone-muted", () => false);
  const isOnHold = useState<boolean>("softphone-hold", () => false);
  const activeAccountIdx = useState<number>("softphone-account", () => 0);
  const config = useState<SoftphoneConfig | null>("softphone-config", () => null);
  const micError = useState<string>("softphone-mic-error", () => "");

  // ── Setup remote audio when a session is established ──

  function setupRemoteAudio(session: Session) {
    const sdh = session.sessionDescriptionHandler as any;
    if (!sdh?.peerConnection) return;

    const pc: RTCPeerConnection = sdh.peerConnection;
    const remoteStream = new MediaStream();
    pc.getReceivers().forEach((receiver) => {
      if (receiver.track) remoteStream.addTrack(receiver.track);
    });

    const audioEl = getRemoteAudio();
    audioEl.srcObject = remoteStream;
  }

  // ── Wire session state changes ──

  function wireSession(session: Session) {
    currentSession = session;

    session.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Establishing:
          // Ringing (outbound already set, inbound already set)
          break;
        case SessionState.Established:
          callState.value = "connected";
          callStartTime.value = Date.now();
          isMuted.value = false;
          isOnHold.value = false;
          setupRemoteAudio(session);
          break;
        case SessionState.Terminated:
          resetCallState();
          break;
      }
    });
  }

  function resetCallState() {
    callState.value = "idle";
    callDirection.value = null;
    remoteNumber.value = "";
    callStartTime.value = null;
    isMuted.value = false;
    isOnHold.value = false;
    micError.value = "";
    currentSession = null;

    const audioEl = document.getElementById("softphone-remote-audio") as HTMLAudioElement;
    if (audioEl) audioEl.srcObject = null;
  }

  // ── Handle incoming calls ──

  function handleInvite(invitation: Invitation) {
    if (callState.value !== "idle") {
      // Already on a call — reject the incoming one
      invitation.reject();
      return;
    }

    callState.value = "ringing-in";
    callDirection.value = "inbound";
    remoteNumber.value = extractNumber(invitation.remoteIdentity?.uri);
    wireSession(invitation);
  }

  // ── Init: fetch config, create UserAgent, register ──

  async function init() {
    // Fetch config from server
    try {
      const data = await $fetch<SoftphoneConfig>("/api/softphone/config");
      config.value = data;

      if (!data.configured) {
        // Not configured is not an error — just stay offline
        regState.value = "unregistered";
        return;
      }
    } catch (err: any) {
      console.warn("[Softphone] Config fetch failed:", err.message);
      regState.value = "unregistered";
      return;
    }

    // If already connected (HMR), skip
    if (ua && regState.value === "registered") return;

    await connectAccount(activeAccountIdx.value);
  }

  async function connectAccount(accountIndex: number) {
    const cfg = config.value;
    if (!cfg?.configured || !cfg.accounts[accountIndex]) return;

    // Tear down existing UA
    await dispose();

    const account = cfg.accounts[accountIndex]!;
    activeAccountIdx.value = accountIndex;
    regState.value = "registering";
    regError.value = "";

    try {
      const uri = UserAgent.makeURI(`sip:${account.extension}@${cfg.domain}`);
      if (!uri) {
        regState.value = "error";
        regError.value = "Invalid SIP URI";
        return;
      }

      const uaOptions: UserAgentOptions = {
        uri,
        transportOptions: {
          server: cfg.wsUrl,
        },
        authorizationUsername: account.extension,
        authorizationPassword: account.password,
        sessionDescriptionHandlerFactoryOptions: {
          peerConnectionConfiguration: {
            iceServers: cfg.stunServer ? [{ urls: cfg.stunServer }] : [],
          },
        },
        delegate: {
          onInvite: handleInvite,
        },
      };

      ua = new UserAgent(uaOptions);

      await ua.start();

      // Auto-reconnect on WebSocket disconnect
      const transport = ua.transport as any;
      if (transport) {
        const origOnDisconnect = transport.onDisconnect;
        transport.onDisconnect = (error?: Error) => {
          console.warn("[Softphone] Transport disconnected", error?.message || "");
          regState.value = "unregistered";
          if (origOnDisconnect) origOnDisconnect.call(transport, error);
          scheduleReconnect();
        };
      }

      registerer = new Registerer(ua);

      registerer.stateChange.addListener((state: RegistererState) => {
        switch (state) {
          case RegistererState.Registered:
            regState.value = "registered";
            regError.value = "";
            reconnectAttempt = 0; // Reset on successful registration
            break;
          case RegistererState.Unregistered:
            regState.value = "unregistered";
            break;
          case RegistererState.Terminated:
            regState.value = "unregistered";
            break;
        }
      });

      await registerer.register();
    } catch (err: any) {
      regState.value = "error";
      regError.value = err.message || "Registration failed";
      console.error("[Softphone] Registration error:", err);
      scheduleReconnect();
    }
  }

  // ── Switch account ──

  async function switchAccount(index: number) {
    if (callState.value !== "idle") return; // Can't switch during a call
    await connectAccount(index);
  }

  // ── Outbound call ──

  async function dial(number: string) {
    if (!ua || callState.value !== "idle" || !config.value) return;

    const target = UserAgent.makeURI(`sip:${number}@${config.value.domain}`);
    if (!target) return;

    callState.value = "ringing-out";
    callDirection.value = "outbound";
    remoteNumber.value = number;
    micError.value = "";

    const codecMod = buildCodecModifier(config.value.codecs || []);

    try {
      const inviter = new Inviter(ua, target, {
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
        ...(codecMod ? { sessionDescriptionHandlerModifiers: [codecMod] } : {}),
      });

      wireSession(inviter);
      await inviter.invite();
    } catch (err: any) {
      console.error("[Softphone] Dial error:", err);
      if (err.message?.includes("Permission") || err.message?.includes("NotAllowed")) {
        micError.value = "Microphone access denied";
      }
      resetCallState();
    }
  }

  // ── Answer incoming call ──

  async function answer() {
    if (!currentSession || callState.value !== "ringing-in") return;

    const codecMod = buildCodecModifier(config.value?.codecs || []);

    try {
      await (currentSession as Invitation).accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
        ...(codecMod ? { sessionDescriptionHandlerModifiers: [codecMod] } : {}),
      });
    } catch (err: any) {
      console.error("[Softphone] Answer error:", err);
      if (err.message?.includes("Permission") || err.message?.includes("NotAllowed")) {
        micError.value = "Microphone access denied";
      }
      resetCallState();
    }
  }

  // ── Reject incoming call ──

  function reject() {
    if (!currentSession || callState.value !== "ringing-in") return;
    (currentSession as Invitation).reject();
    resetCallState();
  }

  // ── Hangup ──

  async function hangup() {
    if (!currentSession) return;

    try {
      switch (currentSession.state) {
        case SessionState.Initial:
        case SessionState.Establishing:
          if (callDirection.value === "outbound") {
            await (currentSession as Inviter).cancel();
          } else {
            await (currentSession as Invitation).reject();
          }
          break;
        case SessionState.Established:
          await currentSession.bye();
          break;
      }
    } catch (err) {
      console.error("[Softphone] Hangup error:", err);
    }

    resetCallState();
  }

  // ── Toggle mute ──

  function toggleMute() {
    if (!currentSession || callState.value !== "connected") return;

    const sdh = currentSession.sessionDescriptionHandler as any;
    if (!sdh?.peerConnection) return;

    const pc: RTCPeerConnection = sdh.peerConnection;
    pc.getSenders().forEach((sender) => {
      if (sender.track?.kind === "audio") {
        sender.track.enabled = isMuted.value; // Toggle: if muted, enable; if unmuted, disable
      }
    });

    isMuted.value = !isMuted.value;
  }

  // ── Toggle hold ──

  async function toggleHold() {
    if (!currentSession || callState.value !== "connected" && callState.value !== "holding") return;

    const sdh = currentSession.sessionDescriptionHandler as any;
    if (!sdh?.peerConnection) return;

    const pc: RTCPeerConnection = sdh.peerConnection;

    if (!isOnHold.value) {
      // Put on hold: set all senders to inactive
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === "audio") sender.track.enabled = false;
      });
      callState.value = "holding";
      isOnHold.value = true;
    } else {
      // Resume: re-enable senders
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === "audio") sender.track.enabled = true;
      });
      callState.value = "connected";
      isOnHold.value = false;
    }
  }

  // ── Send DTMF ──

  function sendDTMF(digit: string) {
    if (!currentSession || callState.value !== "connected") return;

    try {
      currentSession.info({
        requestOptions: {
          body: {
            contentDisposition: "render",
            contentType: "application/dtmf-relay",
            content: `Signal=${digit}\r\nDuration=100\r\n`,
          },
        },
      });
    } catch (err) {
      console.error("[Softphone] DTMF error:", err);
    }
  }

  // ── Blind transfer ──

  async function transfer(target: string) {
    if (!currentSession || !ua || !config.value) return;
    if (callState.value !== "connected") return;

    const targetUri = UserAgent.makeURI(`sip:${target}@${config.value.domain}`);
    if (!targetUri) return;

    try {
      await currentSession.refer(targetUri);
    } catch (err) {
      console.error("[Softphone] Transfer error:", err);
    }
  }

  // ── Dispose: unregister and stop ──

  async function dispose() {
    // Cancel any pending reconnect
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempt = 0;

    try {
      if (currentSession && currentSession.state !== SessionState.Terminated) {
        try { await currentSession.bye(); } catch {}
      }
      resetCallState();

      if (registerer) {
        try { await registerer.unregister(); } catch {}
        registerer = null;
      }

      if (ua) {
        try { await ua.stop(); } catch {}
        ua = null;
      }

      regState.value = "unregistered";
    } catch (err) {
      console.error("[Softphone] Dispose error:", err);
    }
  }

  // ── Auto-reconnect with exponential backoff ──

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.warn("[Softphone] Max reconnect attempts reached");
      regError.value = "Connection lost — click refresh to retry";
      return;
    }

    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempt), 30000);
    reconnectAttempt++;
    console.log(`[Softphone] Reconnecting in ${delay}ms (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        await connectAccount(activeAccountIdx.value);
      } catch (err) {
        console.warn("[Softphone] Reconnect failed:", err);
      }
    }, delay);
  }

  // ── Auto-init when used in browser ──

  if (import.meta.client) {
    // Only auto-init if not already connected
    if (!ua) {
      init();
    }
  }

  return {
    // State
    regState,
    regError,
    callState,
    callDirection,
    remoteNumber,
    callStartTime,
    isMuted,
    isOnHold,
    activeAccountIdx,
    config,
    micError,

    // Actions
    init,
    switchAccount,
    dial,
    answer,
    reject,
    hangup,
    toggleMute,
    toggleHold,
    sendDTMF,
    transfer,
    dispose,
  };
}

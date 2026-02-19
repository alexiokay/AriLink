/**
 * AriLink Channel Plugin for OpenClaw.
 *
 * Implements the ChannelPlugin interface so OpenClaw treats phone calls
 * via Asterisk PBX as a first-class messaging channel — just like
 * WhatsApp, Telegram, or Discord.
 *
 * Incoming calls → Parakeet transcription → OpenClaw AI → TTS → caller hears response
 * OpenClaw AI → initiate_call tool → AriLink dials → same loop
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk";
import {
  connect,
  disconnect,
  getAriLinkSocket,
  resolveConfig,
  type AriLinkConfig,
} from "./runtime.js";

// ─── Types ───

interface ResolvedAriLinkAccount {
  accountId: string;
  config: AriLinkConfig;
  enabled: boolean;
}

interface ActiveCall {
  callId: string;
  callerNumber: string;
  direction: "inbound" | "outbound";
  startedAt: number;
}

// Track active calls for status reporting
const activeCalls = new Map<string, ActiveCall>();

// ─── Channel Plugin ───

export const arilinkChannel: ChannelPlugin<ResolvedAriLinkAccount> = {
  id: "arilink",

  meta: {
    id: "arilink",
    label: "AriLink (Asterisk PBX)",
    selectionLabel: "AriLink — Phone calls via Asterisk",
    docsPath: "/channels/arilink",
    docsLabel: "arilink",
    blurb:
      "Make and receive real phone calls via your own Asterisk PBX with local AI transcription. No Twilio needed.",
    order: 65,
    aliases: ["asterisk", "pbx", "sip"],
  },

  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    edit: false,
    unsend: false,
    reply: false,
    polls: false,
    threads: false,
  },

  // ─── Config adapter ───

  config: {
    listAccountIds: (cfg: any) => {
      const accounts = cfg?.channels?.arilink?.accounts;
      if (!accounts || typeof accounts !== "object") return ["default"];
      return Object.keys(accounts);
    },

    resolveAccount: (cfg: any, accountId?: string | null) => {
      const id = accountId ?? "default";
      const channelCfg = cfg?.channels?.arilink ?? {};
      const accountCfg = channelCfg?.accounts?.[id] ?? {};

      return {
        accountId: id,
        config: resolveConfig(cfg),
        enabled: accountCfg.enabled !== false,
      };
    },

    defaultAccountId: () => "default",

    isConfigured: (account: ResolvedAriLinkAccount) => {
      return !!account.config.arilinkUrl;
    },

    describeAccount: (account: ResolvedAriLinkAccount) => {
      const socket = getAriLinkSocket();
      return {
        label: `Asterisk PBX (${account.config.arilinkUrl})`,
        status: socket?.connected ? "connected" : "disconnected",
        detail: socket?.connected
          ? `${activeCalls.size} active call(s)`
          : "Not connected",
      };
    },
  },

  // ─── Security ───

  security: {
    resolveDmPolicy: () => ({
      policy: "open" as const,
      allowFrom: [],
      policyPath: "channels.arilink.dm.policy",
      allowFromPath: "channels.arilink.dm.allowFrom",
      approveHint: "Phone calls are open by default",
    }),
  },

  // ─── Outbound (OpenClaw → Caller) ───

  outbound: {
    deliveryMode: "direct",

    sendText: async (ctx: any) => {
      const socket = getAriLinkSocket();
      if (!socket?.connected) {
        return { ok: false, error: "Not connected to AriLink" };
      }

      // `ctx.to` is the callId (set during inbound routing)
      const callId = ctx.to;
      const text = ctx.text;

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ ok: false, error: "TTS delivery timed out" });
        }, 15000);

        socket.emit(
          "openclaw:speak",
          { callId, text },
          (response: any) => {
            clearTimeout(timeout);
            resolve(response ?? { ok: true });
          }
        );
      });
    },
  },

  // ─── Gateway (lifecycle + inbound message routing) ───

  gateway: {
    startAccount: async (ctx: any) => {
      const account = ctx.account as ResolvedAriLinkAccount;
      const config = account.config;

      console.log(
        `[AriLink] Starting channel — connecting to ${config.arilinkUrl}`
      );

      const socket = connect(config);

      // ── Incoming call: transcription arrives ──
      socket.on(
        "openclaw:transcription",
        async (data: {
          callId: string;
          text: string;
          isFinal: boolean;
          callerNumber?: string;
        }) => {
          // Only forward final transcriptions to the AI
          if (!data.isFinal || !data.text.trim()) return;

          // Track the call
          if (!activeCalls.has(data.callId)) {
            activeCalls.set(data.callId, {
              callId: data.callId,
              callerNumber: data.callerNumber ?? "unknown",
              direction: "inbound",
              startedAt: Date.now(),
            });
          }

          // Derive a session key from the call
          const sessionKey = `arilink:${account.accountId}:${data.callId}`;

          // Route transcription text to OpenClaw as an incoming message
          try {
            await ctx.rpc.call("router.inbound", {
              envelope: {
                channelId: "arilink",
                accountId: account.accountId,
                sessionKey,
                from: data.callerNumber ?? data.callId,
                fromLabel: data.callerNumber ?? "Phone Call",
                text: data.text,
                to: data.callId,
                chatType: "direct",
                timestamp: Date.now(),
                metadata: {
                  callId: data.callId,
                  direction: "inbound",
                },
              },
            });
          } catch (err: any) {
            console.error(
              `[AriLink] Failed to route transcription: ${err.message}`
            );
          }
        }
      );

      // ── Call ended ──
      socket.on(
        "openclaw:call-ended",
        (data: { callId: string; reason?: string }) => {
          activeCalls.delete(data.callId);
          console.log(
            `[AriLink] Call ${data.callId} ended: ${data.reason ?? "unknown"}`
          );
        }
      );

      // ── Call started (outbound, initiated by tool) ──
      socket.on(
        "openclaw:call-started",
        (data: {
          callId: string;
          number: string;
          direction: string;
        }) => {
          activeCalls.set(data.callId, {
            callId: data.callId,
            callerNumber: data.number,
            direction: data.direction as "inbound" | "outbound",
            startedAt: Date.now(),
          });
          console.log(
            `[AriLink] Call ${data.callId} started: ${data.direction} ${data.number}`
          );
        }
      );

      // ── AriLink status updates ──
      socket.on(
        "openclaw:status",
        (data: { connected: boolean; activeCalls?: number }) => {
          console.log(
            `[AriLink] Status: ARI ${data.connected ? "connected" : "disconnected"}, ${data.activeCalls ?? 0} active call(s)`
          );
        }
      );

      // Handle abort signal for graceful shutdown
      if (ctx.abortSignal) {
        ctx.abortSignal.addEventListener("abort", () => {
          console.log("[AriLink] Shutting down channel");
          disconnect();
          activeCalls.clear();
        });
      }

      return { socket };
    },

    stopAccount: async () => {
      disconnect();
      activeCalls.clear();
      console.log("[AriLink] Channel stopped");
    },
  },

  // ─── Status ───

  status: {
    probe: async () => {
      const socket = getAriLinkSocket();
      return {
        connected: socket?.connected ?? false,
        activeCalls: activeCalls.size,
        calls: Array.from(activeCalls.values()),
      };
    },

    audit: async () => {
      const socket = getAriLinkSocket();
      return {
        connected: socket?.connected ?? false,
        url: resolveConfig({}).arilinkUrl,
      };
    },
  },
};

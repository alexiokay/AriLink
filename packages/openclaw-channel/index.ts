import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { arilinkChannel } from "./src/channel.js";
import { setRuntime } from "./src/runtime.js";

const plugin = {
  id: "arilink",
  name: "AriLink (Asterisk PBX)",
  description:
    "Make and receive phone calls via Asterisk PBX with local AI transcription. Self-hosted alternative to Twilio.",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi): void {
    setRuntime(api.runtime);
    api.registerChannel({ plugin: arilinkChannel });

    // Register agent tools for outbound call control
    api.registerTool({
      id: "arilink-call",
      name: "AriLink Phone Call",
      description:
        "Make and manage real phone calls via Asterisk PBX. Use this to call people, speak to them, transfer calls, or hang up.",
      schema: {
        type: "object",
        oneOf: [
          {
            properties: {
              action: { const: "initiate_call" },
              to: {
                type: "string",
                description:
                  "Phone number or extension to call (e.g., +14155551234 or 1001)",
              },
              message: {
                type: "string",
                description: "Opening message to speak when the call connects",
              },
            },
            required: ["action", "to", "message"],
          },
          {
            properties: {
              action: { const: "speak" },
              callId: { type: "string", description: "Active call ID" },
              message: {
                type: "string",
                description: "Message to speak to the caller",
              },
            },
            required: ["action", "callId", "message"],
          },
          {
            properties: {
              action: { const: "transfer" },
              callId: { type: "string", description: "Active call ID" },
              to: {
                type: "string",
                description: "Extension or number to transfer to",
              },
            },
            required: ["action", "callId", "to"],
          },
          {
            properties: {
              action: { const: "hangup" },
              callId: { type: "string", description: "Active call ID" },
            },
            required: ["action", "callId"],
          },
          {
            properties: {
              action: { const: "status" },
              callId: {
                type: "string",
                description: "Call ID (omit for all active calls)",
              },
            },
            required: ["action"],
          },
        ],
      },
      handler: async (params: any) => {
        const { getAriLinkSocket } = await import("./src/runtime.js");
        const socket = getAriLinkSocket();

        if (!socket?.connected) {
          return {
            ok: false,
            error: "Not connected to AriLink. Check arilinkUrl in config.",
          };
        }

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ ok: false, error: "AriLink did not respond in time" });
          }, 10000);

          socket.emit(
            `openclaw:${params.action}`,
            params,
            (response: any) => {
              clearTimeout(timeout);
              resolve(response);
            }
          );
        });
      },
    });
  },
};

export default plugin;

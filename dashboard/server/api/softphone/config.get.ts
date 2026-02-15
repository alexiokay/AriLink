/**
 * GET /api/softphone/config
 *
 * Returns SIP WebSocket configuration for the browser softphone.
 * Credentials come from env vars — never hardcoded on the client.
 */
export default defineEventHandler(() => {
  const wsUrl = process.env.SIP_WS_URL || "";
  const domain = process.env.SIP_DOMAIN || "";
  const stunServer = process.env.STUN_SERVER || "stun:stun.l.google.com:19302";
  const codecs = (process.env.SIP_CODECS || "opus,PCMU,PCMA,G722,telephone-event").split(",").map((c) => c.trim()).filter(Boolean);

  if (!wsUrl) {
    return { configured: false, error: "SIP_WS_URL not set", wsUrl: "", domain: "", accounts: [], stunServer, codecs };
  }

  let accounts: { extension: string; password: string; label: string }[] = [];
  try {
    const raw = process.env.SIP_ACCOUNTS || "[]";
    accounts = JSON.parse(raw);
  } catch {
    return { configured: false, error: "SIP_ACCOUNTS is not valid JSON", wsUrl, domain, accounts: [], stunServer, codecs };
  }

  if (accounts.length === 0) {
    return { configured: false, error: "No SIP accounts configured", wsUrl, domain, accounts: [], stunServer, codecs };
  }

  return {
    configured: true,
    error: "",
    wsUrl,
    domain,
    stunServer,
    codecs,
    accounts: accounts.map((a) => ({
      extension: a.extension,
      password: a.password,
      label: a.label || a.extension,
    })),
  };
});

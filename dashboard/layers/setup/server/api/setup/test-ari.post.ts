export default defineEventHandler(async (event) => {
  const body = await readBody<{
    pbxIp: string;
    login: string;
    password: string;
  }>(event);

  if (!body.pbxIp || !body.login || !body.password) {
    throw createError({ statusCode: 400, message: "Missing required fields" });
  }

  try {
    const url = `http://${body.pbxIp}:8088/ari/asterisk/info`;
    const auth = Buffer.from(`${body.login}:${body.password}`).toString("base64");
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      return {
        success: true,
        version: data.system?.entity_id || data.build?.os || "Connected",
      };
    }

    if (res.status === 401) {
      return { success: false, error: "Authentication failed — check ARI username and password" };
    }

    return { success: false, error: `ARI returned HTTP ${res.status}` };
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes("ETIMEDOUT") || msg.includes("timeout") || msg.includes("TimeoutError")) {
      return {
        success: false,
        error: `Connection timed out reaching ${body.pbxIp}:8088`,
        hint: "This is most often caused by fail2ban or the FreePBX firewall blocking this server's IP.",
        fail2ban: true,
      };
    }
    if (msg.includes("ECONNREFUSED")) {
      return {
        success: false,
        error: `Connection refused on ${body.pbxIp}:8088`,
        hint: "ARI HTTP server is not running. In FreePBX go to Settings → Advanced Settings → 'Asterisk Builtin mini-HTTP server' and set 'Enable the mini-HTTP Server' to Yes, Bind Port to 8088. Then Apply Config.",
      };
    }
    if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
      return {
        success: false,
        error: `Cannot resolve hostname: ${body.pbxIp}`,
        hint: "The hostname could not be resolved. Use the IP address instead, or check DNS settings.",
      };
    }
    if (msg.includes("EHOSTUNREACH") || msg.includes("ENETUNREACH")) {
      return {
        success: false,
        error: `Host unreachable: ${body.pbxIp}`,
        hint: "This server cannot reach the PBX. Check that both machines are on the same network, or that routing/VPN is configured correctly.",
      };
    }
    return { success: false, error: msg };
  }
});

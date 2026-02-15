/**
 * GET /api/extensions
 *
 * Returns Asterisk PJSIP endpoints (extensions) and contact lists,
 * used by the Transfer Modal on the Calls page.
 */
export default defineEventHandler(async () => {
  const extensions: { resource: string; tech: string; state: string; channel_ids: string[] }[] = [];
  let extensionsError = "";

  const pbxIP = process.env.PBX_IP;
  const login = process.env.ASTERISK_LOGIN;
  const password = process.env.ASTERISK_PASSWORD;

  if (!pbxIP) {
    extensionsError = "PBX_IP not configured";
  } else if (!login || !password) {
    extensionsError = "Asterisk credentials not configured";
  } else {
    try {
      const url = `http://${pbxIP}:8088/ari/endpoints/PJSIP`;
      const auth = Buffer.from(`${login}:${password}`).toString("base64");
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data = await res.json() as any[];
        for (const ep of data) {
          extensions.push({
            resource: ep.resource || "",
            tech: ep.technology || "PJSIP",
            state: ep.state || "unknown",
            channel_ids: ep.channel_ids || [],
          });
        }
        extensions.sort((a, b) => {
          const na = parseInt(a.resource, 10);
          const nb = parseInt(b.resource, 10);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a.resource.localeCompare(b.resource);
        });
      } else if (res.status === 401) {
        extensionsError = "Authentication failed — check ASTERISK_LOGIN/PASSWORD";
      } else {
        extensionsError = `ARI returned ${res.status}`;
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) {
        extensionsError = `Connection to ${pbxIP} timed out`;
      } else if (msg.includes("ECONNREFUSED")) {
        extensionsError = `Connection refused — is ARI running on ${pbxIP}:8088?`;
      } else {
        extensionsError = msg;
      }
    }
  }

  // Load contacts from contact lists
  const contacts: { phone: string; name: string; listName?: string }[] = [];
  try {
    const { readdirSync, readFileSync, existsSync } = await import("fs");
    const { resolve, join } = await import("path");
    const config = useRuntimeConfig();
    const rootDir = config.projectRoot as string;
    const listsDir = resolve(rootDir, "contact-lists");

    if (existsSync(listsDir)) {
      const files = readdirSync(listsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = readFileSync(join(listsDir, file), "utf-8");
          const data = JSON.parse(raw);
          if (Array.isArray(data.entries)) {
            for (const entry of data.entries) {
              contacts.push({
                phone: entry.phone || "",
                name: entry.name || "",
                listName: data.name || "",
              });
            }
          }
        } catch {
          // skip corrupted files
        }
      }
    }
  } catch {
    // contact lists are optional
  }

  return { extensions, contacts, extensionsError };
});

/**
 * PUT /api/softphone/config
 *
 * Saves SIP WebSocket configuration from the softphone setup form.
 * Updates both the .env file and process.env for immediate effect.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

interface SaveBody {
  wsUrl: string;
  domain: string;
  stunServer: string;
  codecs: string[];
  accounts: { extension: string; password: string; label: string }[];
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as SaveBody;

  if (!body.wsUrl?.trim()) {
    throw createError({ statusCode: 400, message: "WebSocket URL is required" });
  }
  if (!body.domain?.trim()) {
    throw createError({ statusCode: 400, message: "SIP Domain is required" });
  }
  if (!body.accounts?.length) {
    throw createError({ statusCode: 400, message: "At least one account is required" });
  }

  // Validate accounts
  for (const acc of body.accounts) {
    if (!acc.extension?.trim()) {
      throw createError({ statusCode: 400, message: "Each account needs an extension" });
    }
    if (!acc.password?.trim()) {
      throw createError({ statusCode: 400, message: `Account ${acc.extension} needs a password` });
    }
  }

  const accountsJson = JSON.stringify(
    body.accounts.map((a) => ({
      extension: a.extension.trim(),
      password: a.password.trim(),
      label: (a.label || a.extension).trim(),
    }))
  );

  // Update process.env immediately
  process.env.SIP_WS_URL = body.wsUrl.trim();
  process.env.SIP_DOMAIN = body.domain.trim();
  process.env.SIP_ACCOUNTS = accountsJson;
  process.env.STUN_SERVER = body.stunServer?.trim() || "stun:stun.l.google.com:19302";
  process.env.SIP_CODECS = (body.codecs?.length ? body.codecs.join(",") : "opus,PCMU,PCMA,G722,telephone-event");

  // Persist to .env file
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const envPath = resolve(rootDir, ".env");

  let content = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const lines = content.split("\n");

  const updates: Record<string, string> = {
    SIP_WS_URL: process.env.SIP_WS_URL,
    SIP_DOMAIN: process.env.SIP_DOMAIN,
    SIP_ACCOUNTS: accountsJson,
    STUN_SERVER: process.env.STUN_SERVER,
    SIP_CODECS: process.env.SIP_CODECS,
  };

  const written = new Set<string>();

  // Update existing lines
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key in updates) {
      lines[i] = `${key}=${updates[key]}`;
      written.add(key);
    }
  }

  // Append new keys
  for (const [key, value] of Object.entries(updates)) {
    if (!written.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  writeFileSync(envPath, lines.join("\n"), "utf-8");

  return { success: true };
});

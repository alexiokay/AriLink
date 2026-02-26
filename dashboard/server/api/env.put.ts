import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { ALLOWED_KEYS, SENSITIVE_KEYS, MASK } from "../utils/env-parser";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const updates: Record<string, string> = (body as any)?.vars;

  if (!updates || typeof updates !== "object") {
    throw createError({ statusCode: 400, message: "Request must include 'vars' object" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const envPath = resolve(rootDir, ".env");

  // Read existing file content
  let content = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const lines = content.split("\n");
  const updatedKeys = new Set<string>();

  // Update existing lines
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    if (key in updates && ALLOWED_KEYS.has(key)) {
      const newValue = updates[key];

      // Skip masked values for sensitive keys (don't overwrite with placeholder)
      if (SENSITIVE_KEYS.has(key) && newValue === MASK) {
        updatedKeys.add(key);
        continue;
      }

      lines[i] = `${key}=${newValue}`;
      updatedKeys.add(key);

      // Also update process.env for immediate effect
      process.env[key] = newValue;
    }
  }

  // Add new keys that weren't in the file
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (updatedKeys.has(key)) continue;
    if (SENSITIVE_KEYS.has(key) && value === MASK) continue;

    lines.push(`${key}=${value}`);
    process.env[key] = value;
  }

  writeFileSync(envPath, lines.join("\n"), "utf-8");

  // Re-materialize Google credentials if they were updated
  if (updatedKeys.has("GOOGLE_CREDENTIALS_JSON")) {
    materializeGoogleCredentials();
  }

  return { success: true };
});

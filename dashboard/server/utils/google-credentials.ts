import { existsSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { resolve } from "path";

const CREDENTIALS_DIR = resolve(process.cwd(), ".credentials");
const CREDENTIALS_FILE = resolve(CREDENTIALS_DIR, "google-service-account.json");

/**
 * Materialize GOOGLE_CREDENTIALS_JSON (base64) → file on disk,
 * then set GOOGLE_APPLICATION_CREDENTIALS so Google SDKs find it.
 *
 * Called on server boot and after saving new credentials.
 */
export function materializeGoogleCredentials(): string | null {
  const b64 = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!b64) {
    // Clean up stale file if env var was removed
    if (existsSync(CREDENTIALS_FILE)) {
      try { unlinkSync(CREDENTIALS_FILE); } catch {}
    }
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    return null;
  }

  try {
    const json = Buffer.from(b64, "base64").toString("utf-8");
    // Validate it's actually JSON with required fields
    const parsed = JSON.parse(json);
    if (!parsed.type || !parsed.project_id) {
      throw new Error("Missing required fields (type, project_id)");
    }

    if (!existsSync(CREDENTIALS_DIR)) {
      mkdirSync(CREDENTIALS_DIR, { recursive: true });
    }
    writeFileSync(CREDENTIALS_FILE, json, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = CREDENTIALS_FILE;
    return CREDENTIALS_FILE;
  } catch (e: any) {
    console.warn(`[Google Credentials] Failed to materialize: ${e.message}`);
    return null;
  }
}

/**
 * Check if Google credentials are configured and valid.
 */
export function hasGoogleCredentials(): boolean {
  const b64 = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!b64) return false;
  try {
    const json = Buffer.from(b64, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    return !!(parsed.type && parsed.project_id);
  } catch {
    return false;
  }
}

/**
 * Get a safe summary of the credentials (project ID + client email) for display.
 */
export function getGoogleCredentialsSummary(): { projectId: string; clientEmail: string } | null {
  const b64 = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!b64) return null;
  try {
    const json = Buffer.from(b64, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    return {
      projectId: parsed.project_id || "",
      clientEmail: parsed.client_email || "",
    };
  } catch {
    return null;
  }
}

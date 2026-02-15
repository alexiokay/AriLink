import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler(() => {
  // Fast path: already in process.env
  if (process.env.MISTRAL_API_KEY) {
    return { configured: true, provider: "Mistral (Codestral)" };
  }

  // Fallback: read .env file directly (same approach as env.get.ts)
  try {
    const rootDir = (useRuntimeConfig().projectRoot || process.cwd()) as string;
    const envPath = resolve(rootDir, ".env");

    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;

        const key = trimmed.slice(0, eqIdx).trim();
        if (key === "MISTRAL_API_KEY") {
          const value = trimmed.slice(eqIdx + 1).trim();
          if (value) {
            // Populate process.env so code-chat.post.ts picks it up
            process.env.MISTRAL_API_KEY = value;
            return { configured: true, provider: "Mistral (Codestral)" };
          }
        }
      }
    }
  } catch (e: any) {
    console.warn("[ai-status] Failed to read .env:", e.message);
  }

  return { configured: false, provider: "Mistral (Codestral)" };
});

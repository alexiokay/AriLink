import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import AdmZip from "adm-zip";
import { parseEnvFile, ALLOWED_KEYS, SENSITIVE_KEYS, MASK } from "../../utils/env-parser";

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({ statusCode: 400, message: "No data uploaded" });
  }

  const fileField = formData.find((f) => f.name === "file");
  const selectionsField = formData.find((f) => f.name === "selections");

  if (!fileField?.data) {
    throw createError({ statusCode: 400, message: "Missing 'file' field" });
  }
  if (!selectionsField?.data) {
    throw createError({ statusCode: 400, message: "Missing 'selections' field" });
  }

  let selections: string[];
  try {
    selections = JSON.parse(selectionsField.data.toString("utf-8"));
  } catch {
    throw createError({ statusCode: 400, message: "Invalid 'selections' JSON" });
  }

  if (!Array.isArray(selections) || selections.length === 0) {
    throw createError({ statusCode: 400, message: "'selections' must be a non-empty array" });
  }

  const runtimeConfig = useRuntimeConfig();
  const rootDir = runtimeConfig.projectRoot as string;

  let zip: AdmZip;
  try {
    zip = new AdmZip(Buffer.from(fileField.data));
  } catch {
    throw createError({ statusCode: 400, message: "Invalid ZIP file" });
  }

  const entries = zip.getEntries();
  const zipFiles = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isDirectory) {
      zipFiles.set(entry.entryName, entry.getData().toString("utf-8"));
    }
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: { file: string; error: string }[] = [];

  for (const sel of selections) {
    if (!zipFiles.has(sel)) {
      skipped.push(sel);
      continue;
    }

    try {
      const content = zipFiles.get(sel)!;

      if (sel === "env.json") {
        // Apply env vars using existing .env write logic
        const backupEnv = JSON.parse(content).vars || {};
        const envPath = resolve(rootDir, ".env");

        let fileContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
        const lines = fileContent.split("\n");
        const updatedKeys = new Set<string>();

        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i]!.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;

          const eqIdx = trimmed.indexOf("=");
          if (eqIdx < 0) continue;

          const key = trimmed.slice(0, eqIdx).trim();
          if (key in backupEnv && ALLOWED_KEYS.has(key)) {
            lines[i] = `${key}=${backupEnv[key]}`;
            updatedKeys.add(key);
            process.env[key] = backupEnv[key];
          }
        }

        // Add new keys from backup
        for (const [key, value] of Object.entries(backupEnv)) {
          if (!ALLOWED_KEYS.has(key)) continue;
          if (updatedKeys.has(key)) continue;
          lines.push(`${key}=${value}`);
          process.env[key] = value as string;
        }

        writeFileSync(envPath, lines.join("\n"), "utf-8");
        applied.push(sel);

      } else if (sel === "routing.json") {
        const routingPath = resolve(rootDir, "config", "routing.json");
        const dir = dirname(routingPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        // Validate it's valid JSON before writing
        JSON.parse(content);
        writeFileSync(routingPath, content, "utf-8");
        applied.push(sel);

      } else if (sel.startsWith("assistants/") && sel.endsWith(".json")) {
        const slug = sel.replace("assistants/", "").replace(".json", "");
        // Validate slug (no path traversal)
        if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
          errors.push({ file: sel, error: "Invalid slug" });
          continue;
        }
        const cfgPath = resolve(rootDir, "assistants", slug, "config.json");
        const dir = dirname(cfgPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        // Validate JSON
        JSON.parse(content);
        writeFileSync(cfgPath, content, "utf-8");
        applied.push(sel);

      } else if (sel.startsWith("contact-lists/") && sel.endsWith(".json")) {
        const filename = sel.replace("contact-lists/", "");
        if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
          errors.push({ file: sel, error: "Invalid filename" });
          continue;
        }
        const filePath = resolve(rootDir, "contact-lists", filename);
        const dir = dirname(filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        // Validate JSON
        JSON.parse(content);
        writeFileSync(filePath, content, "utf-8");
        applied.push(sel);

      } else {
        skipped.push(sel);
      }
    } catch (e: any) {
      errors.push({ file: sel, error: e.message || "Unknown error" });
    }
  }

  return { success: errors.length === 0, applied, skipped, errors };
});

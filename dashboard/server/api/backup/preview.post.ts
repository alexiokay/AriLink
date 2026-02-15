import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";
import AdmZip from "adm-zip";
import { parseEnvFile, ALLOWED_KEYS } from "../../utils/env-parser";

interface DiffEntry {
  key: string;
  current: any;
  backup: any;
}

interface FileChange {
  file: string;
  label: string;
  status: "modified" | "added" | "removed" | "unchanged";
  diff: DiffEntry[];
}

function deepDiff(current: any, backup: any, prefix = ""): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const allKeys = new Set([...Object.keys(current || {}), ...Object.keys(backup || {})]);

  for (const key of allKeys) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const cVal = current?.[key];
    const bVal = backup?.[key];

    if (typeof cVal === "object" && cVal !== null && typeof bVal === "object" && bVal !== null && !Array.isArray(cVal)) {
      diffs.push(...deepDiff(cVal, bVal, fullKey));
    } else if (JSON.stringify(cVal) !== JSON.stringify(bVal)) {
      diffs.push({ key: fullKey, current: cVal ?? null, backup: bVal ?? null });
    }
  }

  return diffs;
}

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event);
  if (!formData) {
    throw createError({ statusCode: 400, message: "No file uploaded" });
  }

  const fileField = formData.find((f) => f.name === "file");
  if (!fileField?.data) {
    throw createError({ statusCode: 400, message: "Missing 'file' field" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;

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

  // Parse meta
  let meta = { version: 0, timestamp: "", hostname: "" };
  if (zipFiles.has("meta.json")) {
    try { meta = JSON.parse(zipFiles.get("meta.json")!); } catch {}
  }

  const changes: FileChange[] = [];

  // 1. Compare env.json
  if (zipFiles.has("env.json")) {
    const envPath = resolve(rootDir, ".env");
    const currentVars = parseEnvFile(envPath);
    const currentFiltered: Record<string, string> = {};
    for (const [k, v] of Object.entries(currentVars)) {
      if (ALLOWED_KEYS.has(k)) currentFiltered[k] = v;
    }

    let backupEnv: Record<string, string> = {};
    try {
      backupEnv = JSON.parse(zipFiles.get("env.json")!).vars || {};
    } catch {}

    const diff = deepDiff(currentFiltered, backupEnv);
    changes.push({
      file: "env.json",
      label: "Environment Variables",
      status: diff.length > 0 ? "modified" : "unchanged",
      diff,
    });
  }

  // 2. Compare routing.json
  if (zipFiles.has("routing.json")) {
    const routingPath = resolve(rootDir, "config", "routing.json");
    let currentRouting = {};
    if (existsSync(routingPath)) {
      try { currentRouting = JSON.parse(readFileSync(routingPath, "utf-8")); } catch {}
    }

    let backupRouting = {};
    try { backupRouting = JSON.parse(zipFiles.get("routing.json")!); } catch {}

    const diff = deepDiff(currentRouting, backupRouting);
    changes.push({
      file: "routing.json",
      label: "Call Routing",
      status: !existsSync(routingPath) ? "added" : diff.length > 0 ? "modified" : "unchanged",
      diff,
    });
  }

  // 3. Compare assistant configs
  const assistantEntries = [...zipFiles.keys()].filter((k) => k.startsWith("assistants/") && k.endsWith(".json"));
  for (const entryName of assistantEntries) {
    const slug = entryName.replace("assistants/", "").replace(".json", "");
    const cfgPath = resolve(rootDir, "assistants", slug, "config.json");

    let currentCfg = {};
    const exists = existsSync(cfgPath);
    if (exists) {
      try { currentCfg = JSON.parse(readFileSync(cfgPath, "utf-8")); } catch {}
    }

    let backupCfg = {};
    try { backupCfg = JSON.parse(zipFiles.get(entryName)!); } catch {}

    const diff = deepDiff(currentCfg, backupCfg);
    changes.push({
      file: entryName,
      label: `Assistant: ${(backupCfg as any).name || slug}`,
      status: !exists ? "added" : diff.length > 0 ? "modified" : "unchanged",
      diff,
    });
  }

  // 4. Compare contact lists
  const contactEntries = [...zipFiles.keys()].filter((k) => k.startsWith("contact-lists/") && k.endsWith(".json"));
  for (const entryName of contactEntries) {
    const filename = entryName.replace("contact-lists/", "");
    const filePath = resolve(rootDir, "contact-lists", filename);

    let currentData = {};
    const exists = existsSync(filePath);
    if (exists) {
      try { currentData = JSON.parse(readFileSync(filePath, "utf-8")); } catch {}
    }

    let backupData = {};
    try { backupData = JSON.parse(zipFiles.get(entryName)!); } catch {}

    const diff = deepDiff(currentData, backupData);
    changes.push({
      file: entryName,
      label: `Contact List: ${(backupData as any).name || filename}`,
      status: !exists ? "added" : diff.length > 0 ? "modified" : "unchanged",
      diff,
    });
  }

  // 5. Check for files that exist locally but not in backup (removed)
  // Assistants
  const assistantsDir = resolve(rootDir, "assistants");
  if (existsSync(assistantsDir)) {
    const localSlugs = readdirSync(assistantsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "base")
      .map((d) => d.name);

    const backupSlugs = new Set(assistantEntries.map((e) => e.replace("assistants/", "").replace(".json", "")));
    for (const slug of localSlugs) {
      if (!backupSlugs.has(slug) && existsSync(resolve(assistantsDir, slug, "config.json"))) {
        changes.push({
          file: `assistants/${slug}.json`,
          label: `Assistant: ${slug}`,
          status: "removed",
          diff: [],
        });
      }
    }
  }

  // Contact lists
  const contactsDir = resolve(rootDir, "contact-lists");
  if (existsSync(contactsDir)) {
    const localFiles = readdirSync(contactsDir).filter((f) => f.endsWith(".json"));
    const backupFiles = new Set(contactEntries.map((e) => e.replace("contact-lists/", "")));
    for (const file of localFiles) {
      if (!backupFiles.has(file)) {
        changes.push({
          file: `contact-lists/${file}`,
          label: `Contact List: ${file}`,
          status: "removed",
          diff: [],
        });
      }
    }
  }

  return { meta, changes };
});

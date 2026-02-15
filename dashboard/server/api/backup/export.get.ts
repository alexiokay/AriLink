import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";
import AdmZip from "adm-zip";
import { parseEnvFile, ALLOWED_KEYS } from "../../utils/env-parser";
import { hostname } from "os";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;

  const zip = new AdmZip();

  // 1. Meta
  const meta = {
    version: 1,
    timestamp: new Date().toISOString(),
    hostname: hostname(),
  };
  zip.addFile("meta.json", Buffer.from(JSON.stringify(meta, null, 2)));

  // 2. Environment variables (only whitelisted keys)
  const envPath = resolve(rootDir, ".env");
  const allVars = parseEnvFile(envPath);
  const filteredVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(allVars)) {
    if (ALLOWED_KEYS.has(key)) {
      filteredVars[key] = value;
    }
  }
  zip.addFile("env.json", Buffer.from(JSON.stringify({ vars: filteredVars }, null, 2)));

  // 3. Routing config
  const routingPath = resolve(rootDir, "config", "routing.json");
  if (existsSync(routingPath)) {
    zip.addFile("routing.json", readFileSync(routingPath));
  }

  // 4. Assistant configs
  const assistantsDir = resolve(rootDir, "assistants");
  if (existsSync(assistantsDir)) {
    const dirs: string[] = readdirSync(assistantsDir, { withFileTypes: true })
      .filter((d: any) => d.isDirectory() && d.name !== "base")
      .map((d: any) => d.name);

    for (const slug of dirs) {
      const cfgPath = resolve(assistantsDir, slug, "config.json");
      if (existsSync(cfgPath)) {
        zip.addFile(`assistants/${slug}.json`, readFileSync(cfgPath));
      }
    }
  }

  // 5. Contact lists
  const contactsDir = resolve(rootDir, "contact-lists");
  if (existsSync(contactsDir)) {
    const files: string[] = readdirSync(contactsDir)
      .filter((f: string) => f.endsWith(".json"));

    for (const file of files) {
      const filePath = resolve(contactsDir, file);
      zip.addFile(`contact-lists/${file}`, readFileSync(filePath));
    }
  }

  // Build ZIP buffer and return
  const zipBuffer = zip.toBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);

  setResponseHeaders(event, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="backup-${dateStr}.zip"`,
    "Content-Length": String(zipBuffer.length),
  });

  return zipBuffer;
});

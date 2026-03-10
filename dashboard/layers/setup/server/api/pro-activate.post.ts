import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const key = (body as any)?.key?.trim();

  if (!key) {
    throw createError({ statusCode: 400, message: "License key is required" });
  }

  const payload = verifyLicenseKey(key);
  if (!payload) {
    throw createError({ statusCode: 400, message: "Invalid or unrecognized license key" });
  }

  // Save to .env (same line-update pattern as env.put.ts)
  const rootDir = (useRuntimeConfig().projectRoot || process.cwd()) as string;
  const envPath = resolve(rootDir, ".env");

  let lines: string[] = [];
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, "utf-8").split("\n");
  }

  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim().startsWith("PRO_LICENSE_KEY=")) {
      lines[i] = `PRO_LICENSE_KEY=${key}`;
      found = true;
      break;
    }
  }
  if (!found) {
    lines.push(`PRO_LICENSE_KEY=${key}`);
  }

  writeFileSync(envPath, lines.join("\n"), "utf-8");
  process.env.PRO_LICENSE_KEY = key;

  return {
    success: true,
    tier: payload.tier,
    licenseId: payload.id,
  };
});

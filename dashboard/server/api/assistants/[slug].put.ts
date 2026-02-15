import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  const runtimeConfig = useRuntimeConfig();
  const rootDir = runtimeConfig.projectRoot as string;
  const configPath = resolve(rootDir, "assistants", slug, "config.json");

  if (!existsSync(configPath)) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  const body = await readBody(event);

  let parsed: any;
  if (body.raw && typeof body.raw === "string") {
    try {
      parsed = JSON.parse(body.raw);
    } catch {
      throw createError({ statusCode: 400, message: "Invalid JSON" });
    }
  } else if (body.config && typeof body.config === "object") {
    parsed = body.config;
  } else {
    throw createError({ statusCode: 400, message: "Request must include 'config' object or 'raw' JSON string" });
  }

  if (!parsed.name) {
    throw createError({ statusCode: 400, message: "Config must have a 'name'" });
  }
  if (!parsed.prompts || typeof parsed.prompts !== "object") {
    throw createError({ statusCode: 400, message: "Config must have a 'prompts' object" });
  }
  if (!parsed.behavior || typeof parsed.behavior !== "object") {
    throw createError({ statusCode: 400, message: "Config must have a 'behavior' object" });
  }

  // Coerce and validate numeric behavior fields
  const numericBounds: Record<string, { min: number; max: number }> = {
    maxRetries: { min: 0, max: 100 },
    timeoutSeconds: { min: 1, max: 300 },
    silenceThresholdSeconds: { min: 1, max: 60 },
    maxNoMatches: { min: 1, max: 100 },
    tryAgainInterval: { min: 1, max: 50 },
  };

  for (const [key, bounds] of Object.entries(numericBounds)) {
    if (key in parsed.behavior) {
      const val = Number(parsed.behavior[key]);
      if (isNaN(val)) {
        throw createError({ statusCode: 400, message: `behavior.${key} must be a number` });
      }
      parsed.behavior[key] = Math.min(bounds.max, Math.max(bounds.min, Math.round(val)));
    }
  }

  // Coerce campaign numeric fields
  if (parsed.campaign && typeof parsed.campaign === "object") {
    if ("maxConcurrent" in parsed.campaign) {
      const val = Number(parsed.campaign.maxConcurrent);
      if (isNaN(val)) {
        throw createError({ statusCode: 400, message: "campaign.maxConcurrent must be a number" });
      }
      parsed.campaign.maxConcurrent = Math.min(50, Math.max(1, Math.round(val)));
    }
  }

  const json = JSON.stringify(parsed, null, 2) + "\n";
  writeFileSync(configPath, json, "utf-8");

  return { success: true, slug, config: parsed };
});

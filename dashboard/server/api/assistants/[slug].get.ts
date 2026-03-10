import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const dir = resolve(rootDir, "assistants", slug);
  const configPath = resolve(dir, "config.json");

  if (!existsSync(configPath)) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw);
  const files = readdirSync(dir);
  const hasCode = files.some((f) => f.endsWith("Assistant.ts"));

  return { slug, config: parsed, raw, dir, hasCode, brain: parsed.brain || null };
});

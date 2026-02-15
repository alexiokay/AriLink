import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const configPath = resolve(rootDir, "assistants", slug, "config.json");

  if (!existsSync(configPath)) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  const raw = readFileSync(configPath, "utf-8");
  const dir = resolve(rootDir, "assistants", slug);
  return { slug, config: JSON.parse(raw), raw, dir };
});

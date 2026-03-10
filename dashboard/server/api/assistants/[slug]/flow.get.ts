import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const assistantDir = resolve(rootDir, "assistants", slug);

  if (!existsSync(assistantDir)) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  const flowPath = join(assistantDir, "flow.json");
  if (!existsSync(flowPath)) {
    return { startNode: "", nodes: {} };
  }

  try {
    const raw = readFileSync(flowPath, "utf-8");
    return JSON.parse(raw);
  } catch (err: any) {
    throw createError({ statusCode: 500, message: `Failed to parse flow.json: ${err.message}` });
  }
});

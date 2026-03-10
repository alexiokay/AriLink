import { existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  const runtimeConfig = useRuntimeConfig();
  const rootDir = runtimeConfig.projectRoot as string;
  const assistantDir = resolve(rootDir, "assistants", slug);

  if (!existsSync(join(assistantDir, "config.json"))) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  const body = await readBody(event);
  const { name, content } = body;

  if (!name || typeof name !== "string") {
    throw createError({ statusCode: 400, message: "name is required" });
  }
  if (!/^[a-z0-9-_]+$/i.test(name)) {
    throw createError({ statusCode: 400, message: "name must contain only letters, numbers, hyphens, and underscores" });
  }
  if (typeof content !== "string") {
    throw createError({ statusCode: 400, message: "content must be a string" });
  }

  const knowledgeDir = join(assistantDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(join(knowledgeDir, `${name}.md`), content, "utf-8");

  return { success: true, name };
});

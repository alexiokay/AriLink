import { existsSync, unlinkSync } from "fs";
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
  const { name } = body;

  if (!name || typeof name !== "string") {
    throw createError({ statusCode: 400, message: "name is required" });
  }
  if (!/^[a-z0-9-_]+$/i.test(name)) {
    throw createError({ statusCode: 400, message: "Invalid knowledge file name" });
  }

  const filePath = join(assistantDir, "knowledge", `${name}.md`);
  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: `Knowledge file '${name}' not found` });
  }

  unlinkSync(filePath);
  return { success: true, name };
});

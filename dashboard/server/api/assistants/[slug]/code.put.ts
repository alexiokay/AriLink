import { readdirSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const assistantDir = resolve(rootDir, "assistants", slug);

  if (!existsSync(assistantDir)) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  const files = readdirSync(assistantDir);
  const tsFile = files.find((f) => f.endsWith("Assistant.ts"));

  if (!tsFile) {
    throw createError({ statusCode: 404, message: `No TypeScript file found for '${slug}'` });
  }

  const body = await readBody(event);
  if (!body.code || typeof body.code !== "string") {
    throw createError({ statusCode: 400, message: "Request must include 'code' string" });
  }

  // Validate that code defines a class extending BaseAssistant (not just a comment mentioning it)
  if (!/class\s+\w+\s+extends\s+BaseAssistant\b/.test(body.code)) {
    throw createError({ statusCode: 400, message: "Code must define a class that extends BaseAssistant" });
  }

  // Validate the class is exported
  if (!/export\s+(default\s+)?class/.test(body.code) && !/module\.exports/.test(body.code)) {
    throw createError({ statusCode: 400, message: "Assistant class must be exported (export class or module.exports)" });
  }

  writeFileSync(join(assistantDir, tsFile), body.code, "utf-8");
  return { success: true, slug, fileName: tsFile };
});

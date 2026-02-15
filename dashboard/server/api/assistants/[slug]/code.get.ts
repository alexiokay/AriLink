import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler((event) => {
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

  // Find the *Assistant.ts file
  const files = readdirSync(assistantDir);
  const tsFile = files.find((f) => f.endsWith("Assistant.ts"));

  if (!tsFile) {
    throw createError({ statusCode: 404, message: `No TypeScript file found for '${slug}'` });
  }

  const code = readFileSync(join(assistantDir, tsFile), "utf-8");

  // Also return base class files for reference
  const basePath = resolve(rootDir, "assistants", "base", "BaseAssistant.ts");
  const baseCode = existsSync(basePath) ? readFileSync(basePath, "utf-8") : null;

  const typesPath = resolve(rootDir, "assistants", "base", "AssistantTypes.ts");
  const typesCode = existsSync(typesPath) ? readFileSync(typesPath, "utf-8") : null;

  return { slug, fileName: tsFile, code, baseCode, typesCode };
});

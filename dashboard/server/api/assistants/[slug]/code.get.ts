import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

function brainSlugToFile(brainSlug: string): string {
  return brainSlug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") + "Brain.ts";
}

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

  // Also return base class files for reference
  const basePath = resolve(rootDir, "assistants", "base", "BaseAssistant.ts");
  const baseCode = existsSync(basePath) ? readFileSync(basePath, "utf-8") : null;

  const typesPath = resolve(rootDir, "assistants", "base", "AssistantTypes.ts");
  const typesCode = existsSync(typesPath) ? readFileSync(typesPath, "utf-8") : null;

  // Find the *Assistant.ts file
  const files = readdirSync(assistantDir);
  const tsFile = files.find((f) => f.endsWith("Assistant.ts"));

  if (tsFile) {
    const code = readFileSync(join(assistantDir, tsFile), "utf-8");
    return { slug, fileName: tsFile, code, baseCode, typesCode, isPreset: false };
  }

  // No assistant code — check if this is a preset (brain-based) assistant
  const configPath = join(assistantDir, "config.json");
  if (existsSync(configPath)) {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    if (parsed.brain) {
      const brainFile = brainSlugToFile(parsed.brain);
      const brainPath = resolve(rootDir, "assistants", "brains", brainFile);
      if (existsSync(brainPath)) {
        const code = readFileSync(brainPath, "utf-8");
        return { slug, fileName: brainFile, code, baseCode, typesCode, isPreset: true, brain: parsed.brain };
      }
    }
  }

  throw createError({ statusCode: 404, message: `No code found for '${slug}'` });
});

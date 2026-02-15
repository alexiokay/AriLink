import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const assistantsDir = resolve(rootDir, "assistants");

  if (!existsSync(assistantsDir)) {
    throw createError({ statusCode: 503, message: "Assistants directory not found" });
  }

  const entries = readdirSync(assistantsDir);
  const assistants = [];

  for (const entry of entries) {
    if (entry === "base") continue;
    const dirPath = join(assistantsDir, entry);
    if (!statSync(dirPath).isDirectory()) continue;

    const configPath = join(dirPath, "config.json");
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      assistants.push({ slug: entry, config: parsed });
    } catch (e: any) {
      assistants.push({ slug: entry, config: null, error: e.message });
    }
  }

  return { assistants };
});

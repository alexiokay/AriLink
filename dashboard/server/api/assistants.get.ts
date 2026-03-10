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
    if (entry === "base" || entry === "brains") continue;
    const dirPath = join(assistantsDir, entry);
    if (!statSync(dirPath).isDirectory()) continue;

    const configPath = join(dirPath, "config.json");
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      const files = readdirSync(dirPath);
      const hasCode = files.some((f) => f.endsWith("Assistant.ts"));
      assistants.push({ slug: entry, config: parsed, hasCode, brain: parsed.brain || null });
    } catch (e: any) {
      assistants.push({ slug: entry, config: null, hasCode: false, brain: null, error: e.message });
    }
  }

  // Discover available brains from assistants/brains/
  const brainsDir = resolve(assistantsDir, "brains");
  const brains: { slug: string; file: string }[] = [];
  if (existsSync(brainsDir)) {
    for (const f of readdirSync(brainsDir)) {
      if (!f.endsWith("Brain.ts")) continue;
      const name = f.replace(".ts", "");
      // PascalCase → kebab-case: IvrTransferBrain → ivr-transfer
      const slug = name
        .replace(/Brain$/, "")
        .replace(/([a-z])([A-Z])/g, "$1-$2")
        .toLowerCase();
      brains.push({ slug, file: f });
    }
  }

  return { assistants, brains };
});

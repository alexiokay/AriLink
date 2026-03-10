import { existsSync, readFileSync, readdirSync, statSync } from "fs";
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

  const read = (file: string): string | null => {
    const p = join(assistantDir, file);
    return existsSync(p) ? readFileSync(p, "utf-8") : null;
  };

  const knowledge: { name: string; content: string }[] = [];
  const knowledgeDir = join(assistantDir, "knowledge");
  if (existsSync(knowledgeDir) && statSync(knowledgeDir).isDirectory()) {
    for (const f of readdirSync(knowledgeDir)) {
      if (!f.endsWith(".md") || f === ".gitkeep") continue;
      knowledge.push({
        name: f.replace(/\.md$/, ""),
        content: readFileSync(join(knowledgeDir, f), "utf-8"),
      });
    }
  }

  // Read tools.json (raw string, parsed by client for editing)
  const toolsJsonPath = join(assistantDir, "tools.json");
  const toolsJson: string | null = existsSync(toolsJsonPath)
    ? readFileSync(toolsJsonPath, "utf-8")
    : null;

  // Read mcpServers from config.json
  const configPath = join(assistantDir, "config.json");
  let mcpServers: Array<{ url: string; name?: string }> = [];
  if (existsSync(configPath)) {
    try {
      mcpServers = JSON.parse(readFileSync(configPath, "utf-8")).mcpServers || [];
    } catch {}
  }

  return {
    systemPrompt: read("system-prompt.md"),
    guardrails: read("guardrails.md"),
    knowledge,
    toolsJson,
    mcpServers,
  };
});

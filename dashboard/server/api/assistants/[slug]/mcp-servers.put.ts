import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  const runtimeConfig = useRuntimeConfig();
  const rootDir = runtimeConfig.projectRoot as string;
  const assistantDir = resolve(rootDir, "assistants", slug);
  const configPath = join(assistantDir, "config.json");

  if (!existsSync(configPath)) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  const body = await readBody(event);
  if (!Array.isArray(body.mcpServers)) {
    throw createError({ statusCode: 400, message: "mcpServers must be an array" });
  }

  // Validate each entry
  const servers = body.mcpServers as Array<{ url: string; name?: string }>;
  for (const s of servers) {
    if (!s.url || typeof s.url !== "string") {
      throw createError({ statusCode: 400, message: "Each MCP server must have a url field" });
    }
    // Only allow http/https — prevent file://, ssrf via other schemes
    let parsed: URL;
    try { parsed = new URL(s.url); } catch {
      throw createError({ statusCode: 400, message: `Invalid MCP server URL: ${s.url}` });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw createError({ statusCode: 400, message: `MCP server URL must use http or https: ${s.url}` });
    }
  }

  // Merge into existing config.json (only update mcpServers field)
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  if (servers.length === 0) {
    delete config.mcpServers;
  } else {
    config.mcpServers = servers;
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  return { success: true };
});

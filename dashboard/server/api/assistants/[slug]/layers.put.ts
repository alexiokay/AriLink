import { existsSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
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

  // Write or delete system-prompt.md
  if ("systemPrompt" in body) {
    const p = join(assistantDir, "system-prompt.md");
    if (body.systemPrompt === null || body.systemPrompt === "") {
      if (existsSync(p)) unlinkSync(p);
    } else if (typeof body.systemPrompt === "string") {
      writeFileSync(p, body.systemPrompt, "utf-8");
    }
  }

  // Write or delete guardrails.md
  if ("guardrails" in body) {
    const p = join(assistantDir, "guardrails.md");
    if (body.guardrails === null || body.guardrails === "") {
      if (existsSync(p)) unlinkSync(p);
    } else if (typeof body.guardrails === "string") {
      writeFileSync(p, body.guardrails, "utf-8");
    }
  }

  // Write or delete tools.json
  if ("toolsJson" in body) {
    const p = join(assistantDir, "tools.json");
    if (body.toolsJson === null || body.toolsJson === "") {
      if (existsSync(p)) unlinkSync(p);
    } else if (typeof body.toolsJson === "string") {
      // Validate it's valid JSON before writing
      try {
        JSON.parse(body.toolsJson);
      } catch {
        throw createError({ statusCode: 400, message: "tools.json must be valid JSON" });
      }
      writeFileSync(p, body.toolsJson, "utf-8");
    }
  }

  return { success: true };
});

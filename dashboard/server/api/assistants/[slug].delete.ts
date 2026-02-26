import { rmSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  // Protect built-in assistants
  const protectedSlugs = ["ivr-transfer", "direct-dial", "auto-dialer-call"];
  if (protectedSlugs.includes(slug)) {
    throw createError({ statusCode: 403, message: "Cannot delete built-in assistant" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const assistantDir = resolve(rootDir, "assistants", slug);

  if (!existsSync(assistantDir)) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  // Check query param ?force=true to bypass routing check
  const query = getQuery(event);
  const force = query.force === "true";

  // Check if this assistant is referenced in routing.json
  const routingPath = resolve(rootDir, "config", "routing.json");
  const usedIn: string[] = [];
  if (existsSync(routingPath)) {
    try {
      const routing = JSON.parse(readFileSync(routingPath, "utf-8"));
      for (const r of routing.extensionRoutes || []) {
        if (r.assistant === slug) usedIn.push(`extension route: ${r.pattern}`);
      }
      for (const r of routing.callerIdRoutes || []) {
        if (r.assistant === slug) usedIn.push(`caller ID route: ${r.pattern}`);
      }
    } catch { /* ignore parse errors */ }
  }

  if (usedIn.length > 0 && !force) {
    throw createError({
      statusCode: 409,
      message: `Assistant is in use by routing: ${usedIn.join(", ")}. Delete with ?force=true to confirm.`,
      data: { usedIn },
    });
  }

  rmSync(assistantDir, { recursive: true, force: true });
  return { success: true, slug, removedFromRouting: usedIn };
});

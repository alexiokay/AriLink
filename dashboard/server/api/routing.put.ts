import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const routingPath = resolve(rootDir, "config", "routing.json");

  const dir = dirname(routingPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const data = {
    extensionRoutes: Array.isArray(body.extensionRoutes) ? body.extensionRoutes : [],
    callerIdRoutes: Array.isArray(body.callerIdRoutes) ? body.callerIdRoutes : [],
  };

  writeFileSync(routingPath, JSON.stringify(data, null, 2) + "\n", "utf-8");

  // Reload routing in AssistantFactory if available
  try {
    const { createRequire } = await import("module");
    const _require = createRequire(process.cwd() + "/package.json");
    const { AssistantFactory } = _require("../../../core/AssistantFactory");
    AssistantFactory.reloadRouting();
  } catch {
    // AssistantFactory may not be loaded yet
  }

  return { success: true };
});

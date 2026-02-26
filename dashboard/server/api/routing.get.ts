import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const routingPath = resolve(rootDir, "config", "routing.json");

  let routing = { extensionRoutes: [] as any[], callerIdRoutes: [] as any[] };
  if (existsSync(routingPath)) {
    try {
      routing = JSON.parse(readFileSync(routingPath, "utf-8"));
    } catch { /* use defaults */ }
  }

  // Include available assistants and brains for dashboard dropdowns
  let assistants: string[] = [];
  let brains: string[] = [];
  try {
    const { createRequire } = require("module");
    const _require = createRequire(process.cwd() + "/package.json");
    const { AssistantFactory } = _require("../../../core/AssistantFactory");
    assistants = AssistantFactory.getAvailableAssistants();
    brains = AssistantFactory.getAvailableBrains();
  } catch { /* AssistantFactory may not be loaded yet */ }

  return { ...routing, assistants, brains };
});

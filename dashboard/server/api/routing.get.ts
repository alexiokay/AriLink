import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const routingPath = resolve(rootDir, "config", "routing.json");

  if (!existsSync(routingPath)) {
    return {
      defaultAssistant: "ivr-transfer",
      extensionRoutes: [],
      callerIdRoutes: [],
    };
  }

  const raw = readFileSync(routingPath, "utf-8");
  return JSON.parse(raw);
});

import { resolve } from "path";
import { ENV_SCHEMA, parseEnvFile } from "../utils/env-parser";

export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const envPath = resolve(rootDir, ".env");
  const fileVars = parseEnvFile(envPath);

  // Build response with schema + current values
  const groups = ENV_SCHEMA.map((group) => ({
    ...group,
    vars: group.vars.map((v) => ({
      ...v,
      value: fileVars[v.key] || "",
    })),
  }));

  return { groups };
});

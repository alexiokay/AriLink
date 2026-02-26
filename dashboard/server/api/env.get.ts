import { resolve } from "path";
import { ENV_SCHEMA, SENSITIVE_KEYS, MASK, parseEnvFile } from "../utils/env-parser";

export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const envPath = resolve(rootDir, ".env");
  const fileVars = parseEnvFile(envPath);

  // Build response with schema + current values
  // Mask sensitive keys — never return raw passwords/API keys
  const groups = ENV_SCHEMA.map((group) => ({
    ...group,
    vars: group.vars.map((v) => {
      const raw = fileVars[v.key] || "";
      return {
        ...v,
        value: raw && SENSITIVE_KEYS.has(v.key) ? MASK : raw,
      };
    }),
  }));

  return { groups };
});

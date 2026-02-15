import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler((event) => {
  const file = getRouterParam(event, "file");
  if (!file || !file.endsWith(".json")) {
    throw createError({ statusCode: 400, message: "Invalid file parameter" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const filePath = resolve(rootDir, "campaign-results", file);

  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: "Campaign not found" });
  }

  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
});

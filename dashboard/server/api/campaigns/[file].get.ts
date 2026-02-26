import { readFileSync, existsSync } from "fs";
import { resolve, basename } from "path";

export default defineEventHandler((event) => {
  const file = getRouterParam(event, "file");
  if (!file || !file.endsWith(".json")) {
    throw createError({ statusCode: 400, message: "Invalid file parameter" });
  }

  // Prevent path traversal: use only the filename component
  const safeFile = basename(file);
  if (!safeFile.endsWith(".json") || safeFile !== file) {
    throw createError({ statusCode: 400, message: "Invalid file parameter" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const campaignDir = resolve(rootDir, "campaign-results");
  const filePath = resolve(campaignDir, safeFile);

  if (!filePath.startsWith(campaignDir)) {
    throw createError({ statusCode: 400, message: "Invalid path" });
  }

  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: "Campaign not found" });
  }

  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
});

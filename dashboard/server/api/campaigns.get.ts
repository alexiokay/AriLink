import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const resultsDir = resolve(rootDir, "campaign-results");

  if (!existsSync(resultsDir)) {
    return { campaigns: [] };
  }

  const files = readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse(); // newest first

  const campaigns = [];

  for (const file of files.slice(0, 50)) {
    try {
      const raw = readFileSync(join(resultsDir, file), "utf-8");
      const data = JSON.parse(raw);
      campaigns.push({
        file,
        name: data.campaignName || "",
        assistantSlug: data.assistantSlug || "auto-dialer-call",
        date: data.campaignDate,
        totalNumbers: data.totalNumbers,
        totalProcessed: data.totalProcessed,
        summary: data.summary || {},
      });
    } catch {
      // skip corrupted files
    }
  }

  return { campaigns };
});

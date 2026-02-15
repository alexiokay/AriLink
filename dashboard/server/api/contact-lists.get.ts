import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const listsDir = resolve(rootDir, "contact-lists");
  const query = getQuery(event);
  const id = query.id as string | undefined;

  if (!existsSync(listsDir)) {
    return id ? null : { lists: [] };
  }

  // Single list by id — return full entries
  if (id) {
    const filePath = join(listsDir, `${id}.json`);
    if (!existsSync(filePath)) {
      throw createError({ statusCode: 404, message: "Contact list not found" });
    }
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  }

  // All lists — metadata only
  const files = readdirSync(listsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  const lists = [];
  for (const file of files.slice(0, 100)) {
    try {
      const raw = readFileSync(join(listsDir, file), "utf-8");
      const data = JSON.parse(raw);
      lists.push({
        id: data.id || file.replace(".json", ""),
        name: data.name || "",
        count: Array.isArray(data.entries) ? data.entries.length : 0,
        createdAt: data.createdAt || "",
      });
    } catch {
      // skip corrupted files
    }
  }

  return { lists };
});

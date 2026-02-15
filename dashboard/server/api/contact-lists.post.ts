import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const listsDir = resolve(rootDir, "contact-lists");

  const body = await readBody(event);
  const { id, name, entries } = body as {
    id?: string;
    name: string;
    entries: { phone: string; name?: string }[];
  };

  if (!name?.trim()) {
    throw createError({ statusCode: 400, message: "Name is required" });
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw createError({ statusCode: 400, message: "Entries must be a non-empty array" });
  }
  for (const entry of entries) {
    if (!entry.phone || typeof entry.phone !== "string") {
      throw createError({ statusCode: 400, message: "Each entry must have a phone string" });
    }
  }

  if (!existsSync(listsDir)) {
    mkdirSync(listsDir, { recursive: true });
  }

  const listId = id || `${name.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${Date.now()}`;
  const filePath = join(listsDir, `${listId}.json`);

  let createdAt = new Date().toISOString();
  if (existsSync(filePath)) {
    try {
      const existing = JSON.parse(readFileSync(filePath, "utf-8"));
      if (existing.createdAt) createdAt = existing.createdAt;
    } catch { /* use new date */ }
  }

  const data = {
    id: listId,
    name: name.trim(),
    entries,
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(filePath, JSON.stringify(data, null, 2));

  return { id: listId, name: data.name, count: entries.length };
});

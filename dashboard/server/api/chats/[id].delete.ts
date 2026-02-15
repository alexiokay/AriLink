import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";

export default defineEventHandler((event) => {
  const id = getRouterParam(event, "id");
  if (!id || !/^[a-z0-9]+$/.test(id)) {
    throw createError({ statusCode: 400, message: "Invalid chat ID" });
  }

  const rootDir = (useRuntimeConfig().projectRoot || process.cwd()) as string;
  const chatsDir = resolve(rootDir, "data", "chats");
  const indexPath = resolve(chatsDir, "index.json");
  const chatPath = resolve(chatsDir, `${id}.json`);

  // Delete chat file
  if (existsSync(chatPath)) {
    unlinkSync(chatPath);
  }

  // Remove from index
  if (existsSync(indexPath)) {
    try {
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      const updated = index.filter((e: any) => e.id !== id);
      writeFileSync(indexPath, JSON.stringify(updated, null, 2), "utf-8");
    } catch { /* ignore */ }
  }

  return { ok: true };
});

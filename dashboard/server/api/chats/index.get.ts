import { readFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

export default defineEventHandler(() => {
  const rootDir = (useRuntimeConfig().projectRoot || process.cwd()) as string;
  const chatsDir = resolve(rootDir, "data", "chats");
  const indexPath = resolve(chatsDir, "index.json");

  if (!existsSync(chatsDir)) {
    mkdirSync(chatsDir, { recursive: true });
  }

  if (!existsSync(indexPath)) {
    return { chats: [] };
  }

  try {
    const raw = readFileSync(indexPath, "utf-8");
    return { chats: JSON.parse(raw) };
  } catch {
    return { chats: [] };
  }
});

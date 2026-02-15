import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

interface ChatIndexEntry {
  id: string;
  label: string;
  createdAt: number;
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id || !/^[a-z0-9]+$/.test(id)) {
    throw createError({ statusCode: 400, message: "Invalid chat ID" });
  }

  const body = await readBody(event) as {
    messages: any[];
    label?: string;
  };

  if (!Array.isArray(body.messages)) {
    throw createError({ statusCode: 400, message: "messages must be an array" });
  }

  const rootDir = (useRuntimeConfig().projectRoot || process.cwd()) as string;
  const chatsDir = resolve(rootDir, "data", "chats");
  const indexPath = resolve(chatsDir, "index.json");
  const chatPath = resolve(chatsDir, `${id}.json`);

  if (!existsSync(chatsDir)) {
    mkdirSync(chatsDir, { recursive: true });
  }

  // Save messages
  writeFileSync(chatPath, JSON.stringify(body.messages, null, 2), "utf-8");

  // Update index
  let index: ChatIndexEntry[] = [];
  try {
    if (existsSync(indexPath)) {
      index = JSON.parse(readFileSync(indexPath, "utf-8"));
    }
  } catch { /* corrupt index, start fresh */ }

  const existing = index.find(e => e.id === id);
  if (existing) {
    if (body.label) existing.label = body.label;
  } else {
    index.unshift({
      id,
      label: body.label || "New chat",
      createdAt: Date.now(),
    });
  }

  writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");

  return { ok: true };
});

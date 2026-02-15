import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export default defineEventHandler((event) => {
  const id = getRouterParam(event, "id");
  if (!id || !/^[a-z0-9]+$/.test(id)) {
    throw createError({ statusCode: 400, message: "Invalid chat ID" });
  }

  const rootDir = (useRuntimeConfig().projectRoot || process.cwd()) as string;
  const chatPath = resolve(rootDir, "data", "chats", `${id}.json`);

  if (!existsSync(chatPath)) {
    return { messages: [] };
  }

  try {
    const raw = readFileSync(chatPath, "utf-8");
    return { messages: JSON.parse(raw) };
  } catch {
    return { messages: [] };
  }
});

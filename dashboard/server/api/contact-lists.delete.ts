import { existsSync, unlinkSync } from "fs";
import { resolve, basename } from "path";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const listsDir = resolve(rootDir, "contact-lists");
  const query = getQuery(event);
  const id = query.id as string;

  if (!id) {
    throw createError({ statusCode: 400, message: "id query parameter is required" });
  }

  // Prevent path traversal: strip directory components, allow only safe chars
  const safeId = basename(id).replace(/\.json$/i, "");
  if (!safeId || !/^[a-zA-Z0-9_-]+$/.test(safeId)) {
    throw createError({ statusCode: 400, message: "Invalid id" });
  }

  const filePath = resolve(listsDir, `${safeId}.json`);
  if (!filePath.startsWith(listsDir)) {
    throw createError({ statusCode: 400, message: "Invalid path" });
  }

  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: "Contact list not found" });
  }

  unlinkSync(filePath);
  return { ok: true };
});

import { existsSync, unlinkSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const listsDir = resolve(rootDir, "contact-lists");
  const query = getQuery(event);
  const id = query.id as string;

  if (!id) {
    throw createError({ statusCode: 400, message: "id query parameter is required" });
  }

  const filePath = join(listsDir, `${id}.json`);
  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: "Contact list not found" });
  }

  unlinkSync(filePath);
  return { ok: true };
});

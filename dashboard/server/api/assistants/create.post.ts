import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve, join } from "path";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { slug, name, templateSlug } = body;

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw createError({ statusCode: 400, message: "Slug must contain only lowercase letters, numbers, and hyphens" });
  }
  if (slug === "base") {
    throw createError({ statusCode: 400, message: "Cannot use reserved slug 'base'" });
  }
  if (!name || typeof name !== "string") {
    throw createError({ statusCode: 400, message: "Name is required" });
  }

  const runtimeConfig = useRuntimeConfig();
  const rootDir = runtimeConfig.projectRoot as string;
  const assistantsDir = resolve(rootDir, "assistants");
  const newDir = resolve(assistantsDir, slug);
  const template = templateSlug || "direct-dial";
  const templateDir = resolve(assistantsDir, template);

  if (existsSync(newDir)) {
    throw createError({ statusCode: 409, message: `Assistant '${slug}' already exists` });
  }
  if (!existsSync(templateDir)) {
    throw createError({ statusCode: 404, message: `Template '${template}' not found` });
  }

  mkdirSync(newDir, { recursive: true });

  // Copy and update config.json
  const templateConfig = JSON.parse(readFileSync(join(templateDir, "config.json"), "utf-8"));
  templateConfig.name = name;
  writeFileSync(join(newDir, "config.json"), JSON.stringify(templateConfig, null, 2) + "\n", "utf-8");

  // Copy and rename the TypeScript file
  const templateFiles = readdirSync(templateDir);
  const templateTs = templateFiles.find((f) => f.endsWith("Assistant.ts"));

  if (templateTs) {
    // Build PascalCase class name, strip trailing "Assistant" to avoid double suffix
    const base = slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");
    const className = base.endsWith("Assistant") ? base : base + "Assistant";
    const newTsName = className + ".ts";

    let code = readFileSync(join(templateDir, templateTs), "utf-8");
    const oldClassName = templateTs.replace(".ts", "");
    code = code.replaceAll(oldClassName, className);

    writeFileSync(join(newDir, newTsName), code, "utf-8");
  }

  return { success: true, slug, name };
});

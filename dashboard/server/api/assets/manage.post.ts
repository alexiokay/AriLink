import { useFilesManager } from "../../utils/files";

/** Allowed base directories for asset management */
function getAllowedBases(): string[] {
  return [
    process.env.AST_SOUNDS_PATH,
    process.env.AST_MOH_PATH,
    process.env.AST_RECORDINGS_PATH,
  ].filter(Boolean) as string[];
}

/** Check that a path starts with one of the allowed base directories */
function isPathAllowed(targetPath: string): boolean {
  const bases = getAllowedBases();
  if (bases.length === 0) return false;
  const normalized = targetPath.replace(/\/+$/, "");
  return bases.some((base) => {
    const normalizedBase = base.replace(/\/+$/, "");
    return normalized === normalizedBase || normalized.startsWith(normalizedBase + "/");
  });
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { action, path, newPath } = body;

  if (!path || typeof path !== "string") {
    throw createError({ statusCode: 400, message: "path is required" });
  }

  // Reject path traversal and validate against allowed directories
  if (path.includes("..") || !isPathAllowed(path)) {
    throw createError({ statusCode: 400, message: "Invalid path" });
  }
  if (newPath && (newPath.includes("..") || !isPathAllowed(newPath))) {
    throw createError({ statusCode: 400, message: "Invalid newPath" });
  }

  const filesManager = useFilesManager();

  try {
    switch (action) {
      case "delete":
        await filesManager.delete(path);
        break;
      case "rename":
        if (!newPath) throw new Error("newPath is required for rename");
        await filesManager.rename(path, newPath);
        break;
      case "mkdir":
        await filesManager.mkdir(path);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return { success: true };
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `Failed to ${action} asset: ${error.message}`,
    });
  }
});

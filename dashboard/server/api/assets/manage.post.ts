import { useFilesManager } from "../../utils/files";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { action, path, newPath } = body;
  
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

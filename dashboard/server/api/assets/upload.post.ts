import { useFilesManager } from "../../utils/files";
import { convertAudio } from "./convert.post";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CONVERTIBLE_EXT = ["wav", "mp3", "ogg", "flac", "aiff", "gsm"];
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event);
  if (!formData) throw createError({ statusCode: 400, message: "No form data" });

  const filesManager = useFilesManager();

  let targetPath = "";
  let fileData: Buffer | null = null;
  let fileName = "";
  let convert = false;

  for (const field of formData) {
    if (field.name === "path") {
      targetPath = field.data.toString();
    } else if (field.name === "file") {
      fileData = field.data;
      fileName = field.filename || "unnamed";
    } else if (field.name === "convert") {
      convert = field.data.toString() === "true";
    }
  }

  if (!targetPath || !fileData) {
    throw createError({ statusCode: 400, message: "Missing path or file" });
  }

  // #8: Reject oversized uploads
  if (fileData.length > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, message: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` });
  }

  const tempPath = join(tmpdir(), `upload-${Date.now()}-${fileName}`);
  writeFileSync(tempPath, fileData);

  try {
    const remoteFilePath = join(targetPath, fileName).replace(/\\/g, "/");
    await filesManager.upload(tempPath, remoteFilePath);

    // Auto-convert if requested and file is a convertible audio format
    let conversion = null;
    if (convert) {
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      if (CONVERTIBLE_EXT.includes(ext)) {
        try {
          const results = await convertAudio(remoteFilePath);
          const succeeded = results.filter((r) => r.success);
          const failed = results.filter((r) => !r.success);
          conversion = {
            converted: succeeded.map((r) => r.format),
            failed: failed.map((r) => ({ format: r.format, error: r.error })),
          };
        } catch (e: any) {
          conversion = { error: e.message || "Conversion failed" };
        }
      }
    }

    return { success: true, path: remoteFilePath, conversion };
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `Failed to upload asset: ${error.message}`,
    });
  } finally {
    // #6: Always clean up temp file, even on failure
    try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch {}
  }
});

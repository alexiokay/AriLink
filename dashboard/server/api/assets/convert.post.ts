import { useFilesManager } from "../../utils/files";

interface ConvertResult {
  format: string;
  file: string;
  success: boolean;
  error?: string;
}

const SOX_COMMANDS: { format: string; args: string }[] = [
  { format: "sln16", args: "-r 16000 -t raw -e signed-integer -b 16" },
  { format: "ulaw", args: "-r 8000 -t raw -e mu-law -b 8" },
  { format: "alaw", args: "-r 8000 -t raw -e a-law -b 8" },
  { format: "g722", args: "-r 16000 -c 1 -t raw -e signed-integer -b 16" },
];

const CONVERTIBLE_EXT = ["wav", "mp3", "ogg", "flac", "aiff", "gsm"];

export async function convertAudio(filePath: string): Promise<ConvertResult[]> {
  const fm = useFilesManager();

  // Check sox availability
  const whichCmd = process.platform === "win32" && !fm.getIsRemote() ? "where sox" : "which sox";
  const check = await fm.exec(whichCmd);
  if (check.code !== 0) {
    throw createError({ statusCode: 500, message: "sox is not installed on the server" });
  }

  // Strip extension to get base path
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) {
    throw createError({ statusCode: 400, message: "File has no extension" });
  }
  const basePath = filePath.substring(0, lastDot);

  const results: ConvertResult[] = [];

  for (const { format, args } of SOX_COMMANDS) {
    const outFile = `${basePath}.${format}`;
    const cmd = `sox "${filePath}" ${args} "${outFile}"`;
    try {
      const result = await fm.exec(cmd);
      if (result.code !== 0) {
        results.push({ format, file: outFile, success: false, error: result.stderr.trim() || `Exit code ${result.code}` });
      } else {
        results.push({ format, file: outFile, success: true });
      }
    } catch (e: any) {
      results.push({ format, file: outFile, success: false, error: e.message });
    }
  }

  return results;
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const filePath = body?.path;

  if (!filePath || typeof filePath !== "string") {
    throw createError({ statusCode: 400, message: "Missing 'path' in request body" });
  }

  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  if (!CONVERTIBLE_EXT.includes(ext)) {
    throw createError({ statusCode: 400, message: `File type .${ext} is not convertible. Supported: ${CONVERTIBLE_EXT.join(", ")}` });
  }

  const results = await convertAudio(filePath);
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  return {
    success: failed.length === 0,
    converted: succeeded.map((r) => r.format),
    failed: failed.map((r) => ({ format: r.format, error: r.error })),
    files: succeeded.map((r) => r.file),
  };
});

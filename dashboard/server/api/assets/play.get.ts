import { useFilesManager } from "../../utils/files";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync } from "fs";

const BROWSER_PLAYABLE = ["wav", "mp3", "ogg", "flac"];

const MIME_MAP: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

// Sox input flags for raw telephony formats (sox can't auto-detect these)
// Formats like gsm are auto-detected by sox and don't need flags
const SOX_INPUT_FLAGS: Record<string, string> = {
  ulaw: "-t raw -r 8000 -e mu-law -b 8 -c 1",
  alaw: "-t raw -r 8000 -e a-law -b 8 -c 1",
  sln16: "-t raw -r 16000 -e signed-integer -b 16 -c 1",
  sln: "-t raw -r 8000 -e signed-integer -b 16 -c 1",
  g722: "-t raw -r 16000 -e signed-integer -b 16 -c 1",
};

function soxCmd(input: string, output: string, ext: string): string {
  const flags = SOX_INPUT_FLAGS[ext] || "";
  return `sox ${flags} "${input}" -t wav -r 16000 -c 1 "${output}"`;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const filePath = query.path as string;
  if (!filePath) throw createError({ statusCode: 400, message: "Path is required" });

  const filesManager = useFilesManager();
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const needsTranscode = !BROWSER_PLAYABLE.includes(ext);

  const tempFiles: string[] = [];
  const remoteCleanup: string[] = [];

  try {
    let localFile = "";

    if (filesManager.getIsRemote()) {
      let remotePath = filePath;
      if (needsTranscode) {
        const remoteTemp = `/tmp/transcode-${Date.now()}.wav`;
        const result = await filesManager.exec(soxCmd(filePath, remoteTemp, ext));
        if (result.code !== 0) {
          throw new Error(`sox failed: ${result.stderr.trim() || `exit code ${result.code}`}`);
        }
        remotePath = remoteTemp;
        remoteCleanup.push(remoteTemp);
      }

      localFile = join(tmpdir(), `play-${Date.now()}.${needsTranscode ? "wav" : ext}`);
      tempFiles.push(localFile);
      const client = await (filesManager as any).getSftp();
      if (!client) throw new Error("SFTP client not initialized");
      await client.fastGet(remotePath, localFile);
    } else {
      if (needsTranscode) {
        localFile = join(tmpdir(), `play-${Date.now()}.wav`);
        tempFiles.push(localFile);
        const result = await filesManager.exec(soxCmd(filePath, localFile, ext));
        if (result.code !== 0) {
          throw new Error(`sox failed: ${result.stderr.trim() || `exit code ${result.code}`}`);
        }
      } else {
        if (!existsSync(filePath)) throw new Error("File not found");
        localFile = filePath;
      }
    }

    const buffer = readFileSync(localFile);
    const contentType = needsTranscode ? "audio/wav" : (MIME_MAP[ext] || "application/octet-stream");

    setResponseHeader(event, "Content-Type", contentType);
    setResponseHeader(event, "Content-Length", buffer.length);
    setResponseHeader(event, "Cache-Control", "no-cache");
    return buffer;
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `Failed to play: ${error.message}`,
    });
  } finally {
    for (const f of tempFiles) {
      try { unlinkSync(f); } catch {}
    }
    for (const f of remoteCleanup) {
      filesManager.exec(`rm -f "${f}"`).catch(() => {});
    }
  }
});

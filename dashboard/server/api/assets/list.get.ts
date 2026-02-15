import { useFilesManager } from "../../utils/files";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const path = (query.path as string) || process.env.AST_SOUNDS_PATH || "/var/lib/asterisk/sounds";
  
  const filesManager = useFilesManager();
  
  try {
    const list = await filesManager.list(path);
    
    // Pre-defined shortcuts for important Asterisk directories
    const shortcuts = [
      { name: "Custom Sounds", path: (process.env.AST_SOUNDS_PATH || "/var/lib/asterisk/sounds") + "/custom", icon: "i-lucide-volume-2", desc: "Your uploaded IVR prompts and announcements" },
      { name: "System Sounds", path: process.env.AST_SOUNDS_PATH || "/var/lib/asterisk/sounds", icon: "i-lucide-audio-lines", desc: "Built-in Asterisk voice prompts (en, pl, etc.)" },
      { name: "Music on Hold", path: process.env.AST_MOH_PATH || "/var/lib/asterisk/moh", icon: "i-lucide-music", desc: "Audio played to callers while on hold or in queue" },
      { name: "Recordings", path: process.env.AST_RECORDINGS_PATH || "/var/spool/asterisk/monitor", icon: "i-lucide-mic", desc: "Call recordings captured by MixMonitor/Record" },
      { name: "Voicemail", path: process.env.AST_VOICEMAIL_PATH || "/var/spool/asterisk/voicemail", icon: "i-lucide-mail", desc: "Voicemail messages organized by context/mailbox" },
      { name: "AGI Scripts", path: process.env.AST_AGI_PATH || "/var/lib/asterisk/agi-bin", icon: "i-lucide-file-code", desc: "AGI/FastAGI scripts executed during calls" },
      { name: "Asterisk Root", path: "/var/lib/asterisk", icon: "i-lucide-hard-drive", desc: "Top-level Asterisk data directory" },
    ];

    return {
      path,
      items: list,
      shortcuts,
      isRemote: !!process.env.SSH_HOST && process.env.SSH_HOST !== "localhost"
    };
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `Failed to list directory: ${error.message}`,
    });
  }
});

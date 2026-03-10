import { resolve } from "path";

export default defineEventHandler(() => {
  const rootDir = (useRuntimeConfig().projectRoot || process.cwd()) as string;
  const envPath = resolve(rootDir, ".env");
  const vars = parseEnvFile(envPath);

  const skipped = vars.SETUP_SKIPPED === "true";
  const missing = ESSENTIAL_KEYS.filter((k: string) => !vars[k]);

  return {
    setupComplete: skipped || missing.length === 0,
    missingKeys: missing,
    configured: {
      pbx: !!vars.PBX_IP,
      credentials: !!vars.ASTERISK_LOGIN && !!vars.ASTERISK_PASSWORD,
      transcription: !!vars.TRANSCRIPTION_SERVICES,
      listener: !!vars.LISTENER_SERVER,
    },
  };
});

import { readFileSync, existsSync } from "fs";

/** Which env vars to expose, grouped for the UI */
export const ENV_SCHEMA = [
  {
    group: "Pro License",
    icon: "i-lucide-shield-check",
    vars: [
      { key: "PRO_LICENSE_KEY", label: "License Key", sensitive: true },
    ],
  },
  {
    group: "Asterisk / ARI",
    icon: "i-lucide-server",
    vars: [
      { key: "PBX_IP", label: "PBX IP Address", sensitive: false },
      { key: "ASTERISK_LOGIN", label: "ARI Username", sensitive: true },
      { key: "ASTERISK_PASSWORD", label: "ARI Password", sensitive: true },
      { key: "STASIS_APP_NAME", label: "Stasis App Name", sensitive: false },
      { key: "EXTERNAL_HOST", label: "External Host IP", sensitive: false },
    ],
  },
  // --- AI Pipeline: STT → LLM → TTS ---
  {
    group: "Transcription",
    icon: "i-lucide-mic",
    vars: [
      { key: "TRANSCRIPTION_PROVIDER", label: "Provider", sensitive: false },
      { key: "TRANSCRIPTION_SERVICES", label: "Service URL", sensitive: false },
      { key: "AUTO_START_TRANSCRIPTION", label: "Auto-start local service", sensitive: false },
      { key: "TRANSCRIPTION_DEVICE", label: "Inference device", sensitive: false },
      { key: "GOOGLE_CREDENTIALS_JSON", label: "Google Service Account JSON", sensitive: true },
    ],
  },
  {
    group: "AI Assistant (Phone)",
    icon: "i-lucide-brain",
    vars: [
      { key: "LLM_PROVIDER", label: "Provider", sensitive: false },
      { key: "LLM_MODEL", label: "Model Name", sensitive: false },
      { key: "LLM_API_KEY", label: "API Key", sensitive: true },
      { key: "LLM_ENDPOINT", label: "Endpoint URL", sensitive: false },
    ],
  },
  {
    group: "TTS (Text-to-Speech)",
    icon: "i-lucide-volume-2",
    vars: [
      { key: "TTS_PROVIDER", label: "Provider", sensitive: false },
      { key: "TTS_SERVICE", label: "Service URL", sensitive: false },
      { key: "TTS_VOICE", label: "Voice", sensitive: false },
      { key: "TTS_SPEED", label: "Speed", sensitive: false },
      { key: "TTS_LANG", label: "Language Code", sensitive: false },
      { key: "ELEVENLABS_API_KEY", label: "ElevenLabs API Key", sensitive: true },
      { key: "ELEVENLABS_VOICE_ID", label: "ElevenLabs Voice ID", sensitive: false },
      { key: "ELEVENLABS_MODEL", label: "ElevenLabs Model", sensitive: false },
    ],
  },
  // --- Infrastructure ---
  {
    group: "Rust RTP Server",
    icon: "i-lucide-radio",
    vars: [
      { key: "USE_RUST_RTP", label: "Enable Rust RTP", sensitive: false },
      { key: "RUST_SERVER_URL", label: "Rust Server URL", sensitive: false },
      { key: "LISTENER_SERVER", label: "RTP Listener Address", sensitive: false },
    ],
  },
  {
    group: "Code Completion",
    icon: "i-lucide-sparkles",
    vars: [
      { key: "MISTRAL_API_KEY", label: "Mistral API Key (Codestral)", sensitive: true },
    ],
  },
  {
    group: "Dialing",
    icon: "i-lucide-phone-outgoing",
    vars: [
      { key: "DEFAULT_ASSISTANT", label: "Default Assistant", sensitive: false },
      { key: "FROM_NUMBER", label: "From Number (primary)", sensitive: false },
      { key: "FROM_NUMBER2", label: "From Number (secondary)", sensitive: false },
      { key: "TEST_PHONE", label: "Test Phone", sensitive: false },
    ],
  },
  {
    group: "WebRTC Softphone",
    icon: "i-lucide-headset",
    vars: [
      { key: "SIP_WS_URL", label: "SIP WebSocket URL (wss://...)", sensitive: false },
      { key: "SIP_DOMAIN", label: "SIP Domain (PBX IP or hostname)", sensitive: false },
      { key: "SIP_ACCOUNTS", label: "Accounts JSON", sensitive: true },
      { key: "STUN_SERVER", label: "STUN Server (optional)", sensitive: false },
      { key: "SIP_CODECS", label: "Audio Codecs (comma-separated)", sensitive: false },
    ],
  },
  {
    group: "SSH / Asset Management",
    icon: "i-lucide-folder-cog",
    vars: [
      { key: "SSH_HOST", label: "SSH Host (empty for local)", sensitive: false },
      { key: "SSH_PORT", label: "SSH Port", sensitive: false },
      { key: "SSH_USER", label: "SSH Username", sensitive: false },
      { key: "SSH_PASSWORD", label: "SSH Password", sensitive: true },
      { key: "SSH_KEY_PATH", label: "SSH Key Path", sensitive: false },
      { key: "AST_SOUNDS_PATH", label: "Asterisk Sounds Path", sensitive: false },
      { key: "AST_MOH_PATH", label: "Asterisk MOH Path", sensitive: false },
      { key: "AST_RECORDINGS_PATH", label: "Asterisk Recordings Path", sensitive: false },
    ],
  },
];

/** Keys that are allowed to be updated via the API */
export const ALLOWED_KEYS = new Set(
  ENV_SCHEMA.flatMap((g) => g.vars.map((v) => v.key))
);

/** Keys whose values should not be overwritten with the masked placeholder */
export const SENSITIVE_KEYS = new Set(
  ENV_SCHEMA.flatMap((g) => g.vars.filter((v) => v.sensitive).map((v) => v.key))
);

/** Keys that must be set for the app to function — triggers setup wizard when missing */
export const ESSENTIAL_KEYS = ["PBX_IP", "ASTERISK_LOGIN", "ASTERISK_PASSWORD"] as const;

export const MASK = "••••••••";

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};

  const content = readFileSync(filePath, "utf-8");
  const vars: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip quotes and inline comments
    value = value.replace(/;.*$/, "").trim();
    value = value.replace(/^["']|["']$/g, "");

    vars[key] = value;
  }

  return vars;
}

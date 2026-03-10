/**
 * Brain-aware Config Tab Schema
 *
 * Defines which config sections and fields to show for each brain type.
 * The Config tab renders fields from this schema instead of blindly
 * dumping every key from config.json.
 */

// --- Types ---

export type FieldType = "text" | "number" | "password" | "select" | "textarea" | "audio";

export interface FieldDef {
  key: string; // dot-path into config, e.g. "behavior.llmProvider"
  label: string;
  type: FieldType;
  placeholder?: string;
  hint?: string;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: any;
  width?: string; // tailwind class, e.g. "w-48"
}

export interface SectionDef {
  id: string;
  title: string;
  icon: string;
  description?: string;
  fields: FieldDef[];
}

export interface BrainConfigSchema {
  sections: SectionDef[];
  showTransfer?: boolean;
  showCampaign?: boolean;
  /** When true, render the generic form for any prompts/behavior keys not covered by the schema */
  showGenericFallback?: boolean;
  /** Informational banner shown at the top of the config form */
  infoBanner?: string;
}

// --- LLM Provider Presets (mirrors PROVIDERS in LlmChatBrain.ts) ---

export const LLM_PROVIDER_PRESETS: Record<string, { endpoint: string; model: string }> = {
  ollama: { endpoint: "http://localhost:11434", model: "llama3.2" },
  gemini: { endpoint: "https://generativelanguage.googleapis.com", model: "gemini-3-flash-preview" },
  openai: { endpoint: "https://api.openai.com", model: "gpt-4o-mini" },
  openrouter: { endpoint: "https://openrouter.ai/api", model: "anthropic/claude-sonnet-4-20250514" },
  custom: { endpoint: "", model: "" },
};

const PROVIDER_OPTIONS = [
  { label: "Ollama (local)", value: "ollama" },
  { label: "Gemini", value: "gemini" },
  { label: "OpenAI", value: "openai" },
  { label: "OpenRouter", value: "openrouter" },
  { label: "Custom endpoint", value: "custom" },
];

// --- Schemas per brain type ---

const SCHEMAS: Record<string, BrainConfigSchema> = {
  flow: {
    sections: [],
    infoBanner: "This assistant is configured entirely via the Flow tab. Use the Flow tab to set up audio, prompts, and branching logic.",
  },

  "llm-chat": {
    sections: [
      {
        id: "llm-connection",
        title: "LLM Connection",
        icon: "i-lucide-brain",
        description: "Env vars $LLM_PROVIDER, $LLM_ENDPOINT, $LLM_MODEL, $LLM_API_KEY override these.",
        fields: [
          { key: "behavior.llmProvider", label: "Provider", type: "select", options: PROVIDER_OPTIONS, width: "w-48", defaultValue: "ollama" },
          { key: "behavior.llmEndpoint", label: "API Endpoint", type: "text", placeholder: "http://localhost:11434", width: "w-72" },
          { key: "behavior.llmModel", label: "Model", type: "text", placeholder: "llama3.2", width: "w-48" },
          { key: "behavior.llmApiKey", label: "API Key", type: "password", placeholder: "sk-...", width: "w-56", hint: "Not needed for Ollama" },
        ],
      },
      {
        id: "conversation",
        title: "Conversation",
        icon: "i-lucide-message-circle",
        fields: [
          { key: "behavior.temperature", label: "Temperature", type: "number", min: 0, max: 2, step: 0.1, defaultValue: 0.7, width: "w-28" },
          { key: "behavior.maxTokens", label: "Max Tokens", type: "number", min: 1, max: 32000, defaultValue: 400, width: "w-28" },
          { key: "behavior.maxHistory", label: "History Turns", type: "number", min: 1, max: 100, defaultValue: 20, width: "w-28" },
          { key: "behavior.silenceTimeoutSec", label: "Silence Timeout (s)", type: "number", min: 0, max: 300, defaultValue: 15, width: "w-32" },
          { key: "behavior.maxSilenceReprompts", label: "Max Reprompts", type: "number", min: 0, max: 10, defaultValue: 2, width: "w-28" },
          { key: "behavior.turnDebounceMs", label: "Debounce (ms)", type: "number", min: 100, max: 5000, defaultValue: 800, width: "w-28" },
        ],
      },
      {
        id: "llm-voice",
        title: "Voice",
        icon: "i-lucide-audio-lines",
        fields: [
          { key: "prompts.welcome", label: "Welcome Audio", type: "audio", placeholder: "custom/welcome", hint: "If empty, TTS greeting is spoken" },
        ],
      },
      {
        id: "llm-system-prompt",
        title: "System Prompt (Fallback)",
        icon: "i-lucide-scroll-text",
        description: "Used when system-prompt.md doesn't exist. Edit in the Prompt tab instead.",
        fields: [
          { key: "behavior.systemPrompt", label: "System Prompt", type: "textarea", placeholder: "You are a helpful phone assistant...", width: "w-full" },
        ],
      },
    ],
  },

  "ivr-transfer": {
    sections: [
      {
        id: "ivr-prompts",
        title: "Voice Prompts",
        icon: "i-lucide-message-square-quote",
        fields: [
          { key: "prompts.welcome", label: "Welcome", type: "audio", placeholder: "custom/welcome_press1", hint: "Played when call connects" },
          { key: "prompts.speakName", label: "Speak Name", type: "audio", placeholder: "custom/speak_your_name", hint: "Played after caller presses 1" },
        ],
      },
      {
        id: "ivr-behavior",
        title: "Behavior",
        icon: "i-lucide-activity",
        fields: [
          { key: "behavior.maxRetries", label: "Max Retries", type: "number", min: 0, max: 100, defaultValue: 3, width: "w-32", hint: "DTMF retry attempts before hangup" },
        ],
      },
    ],
    showTransfer: true,
  },

  "direct-dial": {
    sections: [
      {
        id: "dd-prompts",
        title: "Voice Prompts",
        icon: "i-lucide-message-square-quote",
        fields: [
          { key: "prompts.welcome", label: "Welcome", type: "audio", placeholder: "custom/welcome_2", hint: "Played when call connects" },
          { key: "prompts.tryAgain", label: "Try Again", type: "audio", placeholder: "custom/try_again", hint: "Played periodically after failed matches" },
        ],
      },
      {
        id: "dd-behavior",
        title: "Behavior",
        icon: "i-lucide-activity",
        fields: [
          { key: "behavior.maxNoMatches", label: "Max No-Matches", type: "number", min: 1, max: 100, defaultValue: 12, width: "w-36", hint: "Failed matches before hangup" },
          { key: "behavior.tryAgainInterval", label: "Try Again Interval", type: "number", min: 1, max: 50, defaultValue: 3, width: "w-36", hint: "Play try-again every N failures" },
        ],
      },
    ],
    showTransfer: true,
  },

  openclaw: {
    sections: [
      {
        id: "oc-voice",
        title: "Voice",
        icon: "i-lucide-audio-lines",
        fields: [
          { key: "prompts.welcome", label: "Welcome Audio", type: "audio", placeholder: "custom/openclaw_welcome", hint: "Optional — OpenClaw may send its own greeting" },
        ],
      },
    ],
  },
};

/** Default schema for custom code assistants (no brain) */
const GENERIC_SCHEMA: BrainConfigSchema = {
  sections: [],
  showTransfer: true,
  showCampaign: true,
  showGenericFallback: true,
  infoBanner: "Config fields are consumed by your custom assistant code.",
};

// --- Public API ---

export function getBrainSchema(brain: string | null): BrainConfigSchema {
  if (!brain) return GENERIC_SCHEMA;
  return SCHEMAS[brain] || GENERIC_SCHEMA;
}

/** Read a nested value from an object using a dot-path key */
export function getNestedValue(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const p of parts) {
    if (current == null) return undefined;
    current = current[p];
  }
  return current;
}

/** Set a nested value on an object using a dot-path key, creating intermediate objects as needed.
 *  Always walks through the reactive proxy (no local caching) to preserve Vue reactivity. */
export function setNestedValue(obj: any, path: string, value: any): void {
  const parts = path.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (obj[p] == null || typeof obj[p] !== "object") {
      obj[p] = {};
    }
    obj = obj[p];
  }
  obj[parts[parts.length - 1]!] = value;
}

/** Fill missing config fields with defaults from the schema */
export function ensureDefaults(config: any, schema: BrainConfigSchema): void {
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.defaultValue !== undefined && getNestedValue(config, field.key) === undefined) {
        setNestedValue(config, field.key, field.defaultValue);
      }
    }
  }
}

/** Get all dot-path keys covered by a schema (used to filter generic fallback) */
export function getCoveredKeys(schema: BrainConfigSchema): Set<string> {
  const keys = new Set<string>();
  for (const section of schema.sections) {
    for (const field of section.fields) {
      keys.add(field.key);
    }
  }
  return keys;
}

export enum AssistantState {
  IDLE = "idle",
  LISTENING = "listening",
  PROCESSING = "processing",
  SPEAKING = "speaking",
  TRANSFERRING = "transferring",
}

export interface AssistantConfig {
  name: string;
  mode?: "incoming" | "outbound";
  brain?: string;  // Pluggable brain mode (e.g., "ivr-transfer", "openclaw", "direct-dial")
  language: string;
  prompts: {
    welcome: string;
    goodbye: string;
    error: string;
    timeout: string;
    [key: string]: string;
  };
  behavior: {
    maxRetries: number;
    timeoutSeconds: number;
    silenceThresholdSeconds: number;
    transferDigit?: string;
    maxNoMatches?: number;
    tryAgainInterval?: number;
    [key: string]: unknown;
  };
  transfer?: {
    destination: string;
    trunk: string;
  };
  campaign?: {
    maxConcurrent: number;
    trunk: string;
  };
  mcpServers?: Array<{ url: string; name?: string }>;
}

export interface IAssistant {
  // Lifecycle hooks
  onCallStart(channel: any, callerId: string, extension: string): Promise<void>;
  onCallEnd(channel: any): Promise<void>;

  // Input handlers
  onTranscription(text: string, isFinal: boolean): Promise<void>;
  onDTMFInput(digit: string): Promise<void>;

  // Actions
  playAudio(audioFile: string): Promise<void>;
  transferCall(endpoint: string): Promise<void>;
  hangup(): Promise<void>;

  // State management
  getState(): AssistantState;
  setState(state: AssistantState): void;

  // Config access
  getConfig(): AssistantConfig;

  // Cleanup
  destroy(): void;
}

module.exports = { AssistantState, };

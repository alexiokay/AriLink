export enum AssistantState {
  IDLE = "idle",
  LISTENING = "listening",
  PROCESSING = "processing",
  SPEAKING = "speaking",
  TRANSFERRING = "transferring",
}

export interface AssistantConfig {
  name: string;
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
  };
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

  // Cleanup
  destroy(): void;
}

module.exports = { AssistantState, };

/**
 * Brain Types — Pluggable "brain" interface for assistants.
 *
 * A Brain handles the decision-making logic for a call:
 * - What to do when the caller speaks (transcription)
 * - How to handle DTMF input
 * - When to transfer, speak, or hang up
 *
 * The BrainHarness (assistant shell) handles the telephony plumbing:
 * - Asterisk integration, audio playback, state management
 * - The brain calls harness methods to perform actions
 *
 * Brain modes:
 * - "ivr-transfer"  → DTMF gate → name capture → transfer
 * - "direct-dial"   → Voice → contact match → transfer
 * - "openclaw"      → Forward transcriptions to OpenClaw AI
 * - "auto-dialer"   → Campaign outbound, DTMF response
 * - "personaplex"   → (future) Raw audio ↔ PersonaPlex 7B
 */

import type { AssistantConfig, AssistantState } from "./AssistantTypes";

/**
 * Context passed to module-type tool execute() functions.
 * Gives access to call context and config without exposing the full harness.
 * For call control (transfer/hangup), return "__transfer__:ext" or "__hangup__".
 */
export interface ToolContext {
  callerId: string;
  sessionId: string;
  config: any;
  env: NodeJS.ProcessEnv;
}

/** Handler for a declarative tool (defined in tools.json) */
export type ToolHandler =
  | { type: "http"; method?: string; url: string; query?: Record<string, string>; headers?: Record<string, string>; body?: Record<string, any>; timeout?: number }
  | { type: "webhook"; url: string; headers?: Record<string, string>; timeout?: number }
  | { type: "transfer"; extension: string }
  | { type: "hangup" }
  | { type: "shell"; command: string; timeout?: number }
  | { type: "module"; file: string }
  | { type: "mcp"; serverUrl: string; toolName: string; timeout?: number };

/**
 * A callable tool exposed to the LLM via function calling.
 * Defined in tools.json or auto-discovered from tools/*.ts module exports.
 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema object
  handler: ToolHandler;
  /** Absolute path to the assistant dir — set by AssistantFactory, not by user */
  _assistantDir?: string;
}

/**
 * Prompt layers loaded from .md files in the assistant directory.
 * Used by LLM-based brains to compose a "Safety Sandwich" prompt:
 *   [guardrails] → [system prompt] → [knowledge] → [guardrails]
 */
export interface PromptLayers {
  /** Contents of system-prompt.md (null if file doesn't exist) */
  systemPrompt: string | null;
  /** Contents of guardrails.md (null if file doesn't exist) */
  guardrails: string | null;
  /** Contents of knowledge/*.md files */
  knowledge: { name: string; content: string }[];
  /** Tools loaded from tools.json + tools/*.ts */
  tools: AgentTool[];
}

/**
 * The harness interface exposed to brains.
 * Brains call these methods to interact with the telephony layer.
 */
export interface IBrainHarness {
  // Audio
  playAudio(audioFile: string): Promise<void>;
  playAudioNoWait(audioFile: string): Promise<void>;
  playAudioWithFallback(primary: string, fallback: string): Promise<void>;

  // TTS — synthesize text and play to caller
  speak(text: string): Promise<void>;

  /** Cancel current speech + clear queue. Rejects pending speak() with BargeInError. */
  cancelSpeaking(): void;

  // Call control
  transferCall(endpoint: string): Promise<void>;
  hangup(): Promise<void>;

  // State
  setState(state: AssistantState, detail?: string): void;
  getState(): AssistantState;
  isState(...states: AssistantState[]): boolean;

  // Events — brain emits events that the controller listens to
  emitEvent(event: string, data: any): void;

  // Context
  readonly sessionId: string;
  readonly config: AssistantConfig;
  readonly layers: PromptLayers;

  // Data access
  getContacts(): any;
}

/**
 * Brain interface — implement this to create a new brain mode.
 *
 * Each brain handles the "thinking" part of a call:
 * - What to say/play when a call starts
 * - How to respond to transcriptions and DTMF
 * - When to transfer or hang up
 */
export interface IBrain {
  /** Called once when the brain is attached to a harness */
  init(harness: IBrainHarness): void;

  /** Called when a new call starts */
  onCallStart(callerId: string, extension: string): Promise<void>;

  /** Called when the caller speaks (transcription result) */
  onTranscription(text: string, isFinal: boolean): Promise<void>;

  /** Called when the caller presses a DTMF key */
  onDTMFInput(digit: string): Promise<void>;

  /** Called when the call ends */
  onCallEnd(): Promise<void>;

  /** Called when TTS playback finishes (brain can resume listening) */
  onSpeakingDone?(): void;

  /** Called when the user interrupts bot speech (barge-in). Text is the interrupting utterance. */
  onBargeIn?(text: string): void;

  /** Cleanup */
  destroy(): void;
}


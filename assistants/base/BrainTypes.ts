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


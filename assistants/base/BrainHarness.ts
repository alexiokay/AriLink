/**
 * BrainHarness — Universal assistant that delegates to a pluggable Brain.
 *
 * Instead of hardcoding call logic in each assistant subclass, the BrainHarness
 * handles all telephony plumbing and delegates decisions to an IBrain instance.
 *
 * Shared voice intelligence (benefits ALL brains):
 * - Filler sound filtering (um, uh, mm) — never forwarded to brain
 * - Turn-end debouncing (600ms default) — accumulates rapid-fire finals into one turn
 * - VAD-based endpointing — speech_started resets debounce so mid-sentence pauses
 *   don't split utterances ("I need uh... something" → one turn, not two)
 * - Extended post-barge-in debounce (1000ms) — catches full utterance after interrupt
 * - Interim transcription passthrough — brains that need interims still get them
 *
 * Usage in config.json:
 *   { "brain": "ivr-transfer", ... }
 *
 * The AssistantFactory detects the "brain" field and creates:
 *   new BrainHarness(config, client, sessionId, contacts, brain)
 */

const { BaseAssistant } = require("./BaseAssistant");
const { AssistantState } = require("./AssistantTypes");

import type { AssistantConfig, AssistantState as AssistantStateType } from "./AssistantTypes";
import type { IBrain, IBrainHarness, PromptLayers } from "./BrainTypes";

/**
 * Sentinel error thrown when barge-in cancels a pending speak() call.
 * Brains should catch this in their streaming loops to abort gracefully.
 */
class BargeInError extends Error {
  constructor() {
    super("barge-in");
    this.name = "BargeInError";
  }
}

// Filler sounds that never constitute a meaningful response.
// Only genuine non-word vocalizations. Real words like "yes", "hello", "ok"
// are valid responses and must NOT be filtered.
const FILLER_SOUNDS = new Set([
  "mm", "mmm", "mhm", "mm hmm", "mmhmm", "uh huh",
  "um", "umm", "uh", "ah", "ahh", "oh", "ohh",
]);

class BrainHarness extends BaseAssistant implements IBrainHarness {
  private brain: IBrain;
  private contacts: any;
  private _layers: PromptLayers;
  private callerId: string = "";
  private extension: string = "";
  private speakResolve: (() => void) | null = null; // For awaitable speak()
  private speakReject: ((err: Error) => void) | null = null; // For barge-in cancellation

  // Shared voice intelligence state
  private turnDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private turnBuffer = "";
  private lastBargeInAtMs = 0;
  private turnDebounceMs = 600;

  constructor(
    config: AssistantConfig,
    client: any,
    sessionId: string,
    contacts: any,
    brain: IBrain,
    layers?: PromptLayers
  ) {
    super(config, client, sessionId);
    this.contacts = contacts;
    this.brain = brain;
    this._layers = layers ?? { systemPrompt: null, guardrails: null, knowledge: [] };

    // Read turn debounce from per-agent config
    const behavior: any = config.behavior || {};
    this.turnDebounceMs = behavior.turnDebounceMs || 800;

    // Give the brain access to the harness
    this.brain.init(this);
  }

  get layers(): PromptLayers {
    return this._layers;
  }

  // ── Lifecycle (delegates to brain) ──

  async onCallStart(channel: any, callerId: string, extension: string): Promise<void> {
    this.channel = channel;
    this.callerId = callerId;
    this.extension = extension;

    console.log(
      `[BrainHarness][Session ${this.sessionId}] Call started from ${callerId} on ext ${extension} (brain: ${this.config.brain || "unknown"})`
    );

    await this.brain.onCallStart(callerId, extension);
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    // Interim / speech_started — pass through to brain, but also use as
    // endpointing signal: if we're accumulating a turn and the user starts
    // speaking again, reset the debounce so we don't fire half a sentence.
    if (!isFinal) {
      if (this.turnDebounceTimer && this.turnBuffer) {
        clearTimeout(this.turnDebounceTimer);
        this.turnDebounceTimer = setTimeout(async () => {
          this.turnDebounceTimer = null;
          const fullText = this.turnBuffer;
          this.turnBuffer = "";
          console.log(`[BrainHarness][Session ${this.sessionId}] Turn ready: "${fullText}"`);
          await this.brain.onTranscription(fullText, true);
        }, this.turnDebounceMs);
      }
      await this.brain.onTranscription(text, false);
      return;
    }

    // ── Shared voice intelligence for final transcriptions ──

    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 3) return;

    // Filler sound filtering — "um", "uh", "mm hmm" never need a brain response
    const normalized = trimmed.toLowerCase().replace(/[.,!?;:'"…\-–—]/g, "").trim();
    if (FILLER_SOUNDS.has(normalized)) {
      console.log(`[BrainHarness][Session ${this.sessionId}] Filler filtered: "${trimmed}"`);
      return;
    }

    // Turn-end debounce: accumulate rapid-fire finals into one turn.
    // STT often sends "I want to book a" (final) then "dentist appointment" (final)
    // as two events. Debounce concatenates them into one brain call.
    if (this.turnDebounceTimer) {
      clearTimeout(this.turnDebounceTimer);
    }
    this.turnBuffer = this.turnBuffer ? this.turnBuffer + " " + trimmed : trimmed;

    // After barge-in, use longer debounce to capture the full utterance.
    // STT sends partial finals faster during speech — extended debounce prevents
    // processing just "How" when user said "How about a story".
    const recentBargeIn = Date.now() - this.lastBargeInAtMs < 2000;
    const debounceMs = recentBargeIn ? Math.max(1000, this.turnDebounceMs) : this.turnDebounceMs;

    this.turnDebounceTimer = setTimeout(async () => {
      this.turnDebounceTimer = null;
      const fullText = this.turnBuffer;
      this.turnBuffer = "";
      console.log(`[BrainHarness][Session ${this.sessionId}] Turn ready: "${fullText}"`);
      await this.brain.onTranscription(fullText, true);
    }, debounceMs);
  }

  async onDTMFInput(digit: string): Promise<void> {
    await this.brain.onDTMFInput(digit);
  }

  async onCallEnd(channel: any): Promise<void> {
    console.log(
      `[BrainHarness][Session ${this.sessionId}] Call ended`
    );
    if (this.turnDebounceTimer) {
      clearTimeout(this.turnDebounceTimer);
      this.turnDebounceTimer = null;
    }
    this.turnBuffer = "";
    await this.brain.onCallEnd();
    this.setState(AssistantState.IDLE);
  }

  // ── IBrainHarness API (exposed to brains) ──

  /**
   * Synthesize text and play it to the caller via TTS.
   * Returns a Promise that resolves when playback finishes,
   * or rejects with BargeInError if the user interrupts.
   */
  async speak(text: string): Promise<void> {
    this.setState(AssistantState.SPEAKING);
    return new Promise<void>((resolve, reject) => {
      this.speakResolve = resolve;
      this.speakReject = reject;
      this.emit("speakRequest", {
        sessionId: this.sessionId,
        text,
      });
    });
  }

  /**
   * Called when TTS playback finishes (from AriControllerServer).
   */
  onSpeakingDone(): void {
    // If already cancelled by barge-in, speakReject is null — skip
    if (this.speakResolve) {
      const resolve = this.speakResolve;
      this.speakResolve = null;
      this.speakReject = null;
      resolve();
    }

    if (this.brain.onSpeakingDone) {
      this.brain.onSpeakingDone();
    }

    // Fallback: if brain didn't handle the state transition, do it here
    if (this.isState(AssistantState.SPEAKING)) {
      this.setState(AssistantState.LISTENING);
    }
  }

  /**
   * Cancel current speech. Rejects the pending speak() Promise with BargeInError,
   * which unblocks the brain's streaming loop so it can process the interruption.
   * Called by AriControllerServer when barge-in is detected.
   */
  cancelSpeaking(): void {
    if (this.speakReject) {
      const reject = this.speakReject;
      this.speakResolve = null;
      this.speakReject = null;
      reject(new BargeInError());
    }
  }

  /**
   * Notify the brain that the user interrupted bot speech.
   * Called by AriControllerServer after cancelling playback.
   * Also tracks barge-in timing for extended debounce window.
   */
  notifyBargeIn(text: string): void {
    this.lastBargeInAtMs = Date.now();

    // Clear turn debounce — the barge-in text IS the new turn
    if (this.turnDebounceTimer) {
      clearTimeout(this.turnDebounceTimer);
      this.turnDebounceTimer = null;
      this.turnBuffer = "";
    }

    if (this.brain.onBargeIn) {
      this.brain.onBargeIn(text);
    }
  }

  /**
   * Emit an event from the brain to the controller.
   * Brains use this to trigger transfers, OpenClaw events, etc.
   */
  emitEvent(event: string, data: any): void {
    this.emit(event, data);
  }

  /**
   * Get the contacts data (for contact matching brains).
   */
  getContacts(): any {
    return this.contacts;
  }

  destroy(): void {
    // Clean up debounce timer
    if (this.turnDebounceTimer) {
      clearTimeout(this.turnDebounceTimer);
      this.turnDebounceTimer = null;
    }
    this.turnBuffer = "";
    // Clean up any pending speak Promise
    if (this.speakReject) {
      this.speakResolve = null;
      this.speakReject = null;
    }
    this.brain.destroy();
    super.destroy();
  }
}

module.exports.BrainHarness = BrainHarness;
module.exports.BargeInError = BargeInError;

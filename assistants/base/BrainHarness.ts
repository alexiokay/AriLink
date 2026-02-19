/**
 * BrainHarness — Universal assistant that delegates to a pluggable Brain.
 *
 * Instead of hardcoding call logic in each assistant subclass, the BrainHarness
 * handles all telephony plumbing and delegates decisions to an IBrain instance.
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
import type { IBrain, IBrainHarness } from "./BrainTypes";

class BrainHarness extends BaseAssistant implements IBrainHarness {
  private brain: IBrain;
  private contacts: any;
  private callerId: string = "";
  private extension: string = "";

  constructor(
    config: AssistantConfig,
    client: any,
    sessionId: string,
    contacts: any,
    brain: IBrain
  ) {
    super(config, client, sessionId);
    this.contacts = contacts;
    this.brain = brain;

    // Give the brain access to the harness
    this.brain.init(this);
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
    await this.brain.onTranscription(text, isFinal);
  }

  async onDTMFInput(digit: string): Promise<void> {
    await this.brain.onDTMFInput(digit);
  }

  async onCallEnd(channel: any): Promise<void> {
    console.log(
      `[BrainHarness][Session ${this.sessionId}] Call ended`
    );
    await this.brain.onCallEnd();
    this.setState(AssistantState.IDLE);
  }

  // ── IBrainHarness API (exposed to brains) ──

  /**
   * Synthesize text and play it to the caller via TTS.
   * Emits "speakRequest" event — AriControllerServer handles the actual synthesis.
   */
  async speak(text: string): Promise<void> {
    this.setState(AssistantState.SPEAKING);
    this.emit("speakRequest", {
      sessionId: this.sessionId,
      text,
    });
  }

  /**
   * Called when TTS playback finishes (from AriControllerServer).
   */
  onSpeakingDone(): void {
    if (this.brain.onSpeakingDone) {
      this.brain.onSpeakingDone();
    } else if (this.isState(AssistantState.SPEAKING)) {
      this.setState(AssistantState.LISTENING);
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
    this.brain.destroy();
    super.destroy();
  }
}

module.exports.BrainHarness = BrainHarness;

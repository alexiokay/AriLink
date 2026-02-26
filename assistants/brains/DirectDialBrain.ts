/**
 * Direct Dial Brain
 *
 * Extracted from DirectDialAssistant. Handles the direct voice dial flow:
 * 1. Play welcome
 * 2. Listen for voice immediately (no DTMF gate)
 * 3. Match transcription against contacts
 * 4. Match → transfer, no match → retry with feedback
 */

const { ContactMatcher } = require("../../tools/ContactMatcher");
const { RetryManager } = require("../../tools/RetryManager");
const { AssistantState } = require("../base/AssistantTypes");

import type { IBrain, IBrainHarness } from "../base/BrainTypes";

class DirectDialBrain implements IBrain {
  private harness!: IBrainHarness;
  private contactMatcher: any;
  private retryManager: any;

  init(harness: IBrainHarness): void {
    this.harness = harness;

    const contacts = harness.getContacts?.() || null;
    this.contactMatcher = new ContactMatcher(contacts);

    const maxRetries = (harness.config.behavior.maxNoMatches as number) || 12;
    const interval = (harness.config.behavior.tryAgainInterval as number) || 3;

    this.retryManager = new RetryManager({
      maxRetries,
      onMaxReached: () => {
        console.log(`[DirectDialBrain][Session ${harness.sessionId}] Max no-matches, hanging up`);
        harness.hangup();
      },
      feedbackIntervals: Array.from(
        { length: Math.floor(maxRetries / interval) - 1 },
        (_, i) => (i + 1) * interval
      ),
      onFeedback: () => {
        harness.playAudioNoWait(harness.config.prompts.tryAgain);
      },
    });
  }

  async onCallStart(callerId: string, extension: string): Promise<void> {
    const sid = this.harness.sessionId;
    console.log(`[DirectDialBrain][Session ${sid}] Call from ${callerId} on ext ${extension}`);

    this.harness.setState(AssistantState.SPEAKING);
    await this.harness.playAudioWithFallback(
      this.harness.config.prompts.welcome,
      "hello-world"
    );

    // Immediately listen for voice
    this.harness.setState(AssistantState.PROCESSING);
    this.harness.playAudioNoWait("beep");
  }

  async onDTMFInput(digit: string): Promise<void> {
    // No DTMF in direct dial
    console.log(`[DirectDialBrain][Session ${this.harness.sessionId}] DTMF ignored: ${digit}`);
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    if (!this.harness.isState(AssistantState.PROCESSING)) return;

    const sid = this.harness.sessionId;
    console.log(`[DirectDialBrain][Session ${sid}] Transcription (${isFinal ? "FINAL" : "interim"}): "${text}"`);

    const foundNumber = this.contactMatcher.findNumberByWords(text);

    if (foundNumber === "no-match") {
      this.harness.playAudioNoWait("beep");
      this.retryManager.attempt();
    } else {
      console.log(`[DirectDialBrain][Session ${sid}] Contact matched: ${foundNumber}`);
      this.harness.setState(AssistantState.TRANSFERRING, foundNumber);
      this.harness.emitEvent("contactMatched", {
        sessionId: sid,
        name: text.trim(),
        number: foundNumber,
      });
    }
  }

  async onCallEnd(): Promise<void> {
    console.log(`[DirectDialBrain][Session ${this.harness.sessionId}] Call ended. Retries: ${this.retryManager.getCount()}`);
  }

  destroy(): void {
    // Nothing to clean up
  }
}

module.exports.DirectDialBrain = DirectDialBrain;

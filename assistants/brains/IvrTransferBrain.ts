/**
 * IVR Transfer Brain
 *
 * Extracted from IvrTransferAssistant. Handles the IVR call flow:
 * 1. Play welcome → "Press 1"
 * 2. Wait for DTMF "1"
 * 3. Play → "Speak your name"
 * 4. Capture transcription → immediately transfer
 */

const { ContactMatcher } = require("../../tools/ContactMatcher");
const { RetryManager } = require("../../tools/RetryManager");
const { AssistantState } = require("../base/AssistantTypes");

import type { IBrain, IBrainHarness } from "../base/BrainTypes";

class IvrTransferBrain implements IBrain {
  private harness!: IBrainHarness;
  private callerName: string = "";
  private contactMatcher: any;
  private retryManager: any;

  init(harness: IBrainHarness): void {
    this.harness = harness;

    const contacts = harness.getContacts?.() || null;
    this.contactMatcher = new ContactMatcher(contacts);
    this.retryManager = new RetryManager({
      maxRetries: harness.config.behavior.maxRetries || 3,
      onMaxReached: () => {
        console.log(`[IvrTransferBrain][Session ${harness.sessionId}] Max retries reached`);
        harness.hangup();
      },
    });
  }

  async onCallStart(callerId: string, extension: string): Promise<void> {
    // Play welcome: "Welcome. Press 1."
    this.harness.setState(AssistantState.SPEAKING);
    await this.harness.playAudioWithFallback(
      this.harness.config.prompts.welcome,
      "hello-world"
    );

    // Wait for DTMF "1"
    this.harness.setState(AssistantState.LISTENING);
    this.harness.playAudioNoWait("beep");
  }

  async onDTMFInput(digit: string): Promise<void> {
    const sid = this.harness.sessionId;
    console.log(`[IvrTransferBrain][Session ${sid}] DTMF: ${digit}`);

    if (this.harness.isState(AssistantState.LISTENING) && digit === "1") {
      // Prompt for name
      this.harness.setState(AssistantState.SPEAKING);
      await this.harness.playAudioWithFallback(
        this.harness.config.prompts.speakName,
        "beep"
      );

      // Wait for voice input
      this.harness.setState(AssistantState.PROCESSING);
      this.harness.playAudioNoWait("beep");

    } else if (this.harness.isState(AssistantState.LISTENING)) {
      this.harness.playAudioNoWait("beep");
      this.retryManager.attempt();
    }
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    if (!this.harness.isState(AssistantState.PROCESSING)) return;

    const sid = this.harness.sessionId;
    console.log(`[IvrTransferBrain][Session ${sid}] Transcription (${isFinal ? "FINAL" : "interim"}): "${text}"`);

    // Immediate transfer on 3+ chars
    if (text.trim().length >= 3) {
      this.callerName = text.trim();
      console.log(`[IvrTransferBrain][Session ${sid}] Name: "${this.callerName}" → transferring`);

      // Try contact match first
      const matchedNumber = this.contactMatcher.findNumberByWords(text);
      if (matchedNumber !== "no-match") {
        console.log(`[IvrTransferBrain][Session ${sid}] Contact matched: ${matchedNumber}`);
        this.harness.emitEvent("contactMatched", {
          sessionId: sid,
          name: this.callerName,
          number: matchedNumber,
        });
        this.harness.setState(AssistantState.TRANSFERRING, matchedNumber);
        return;
      }

      // No match → transfer to configured destination
      this.harness.emitEvent("transferToDestination", {
        sessionId: sid,
        callerName: this.callerName,
      });
      this.harness.setState(AssistantState.TRANSFERRING, "destination");
    }
  }

  async onCallEnd(): Promise<void> {
    console.log(`[IvrTransferBrain][Session ${this.harness.sessionId}] Call ended. Name: "${this.callerName}"`);
  }

  destroy(): void {
    // Nothing to clean up
  }
}

module.exports.IvrTransferBrain = IvrTransferBrain;

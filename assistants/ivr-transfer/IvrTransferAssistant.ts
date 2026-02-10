const { BaseAssistant } = require("../base/BaseAssistant");
const { ContactMatcher } = require("../../tools/ContactMatcher");
const { RetryManager } = require("../../tools/RetryManager");

import type { AssistantConfig, AssistantState } from "../base/AssistantTypes";

const ivrConfig: AssistantConfig = require("./config.json");

/**
 * IVR Transfer Assistant
 *
 * Call flow:
 * 1. Play welcome prompt: "Welcome. Press 1."
 * 2. Wait for DTMF "1"
 * 3. Play: "Speak your name."
 * 4. Capture transcription → IMMEDIATELY transfer to configured destination
 *
 * States:
 * - idle: No active call
 * - listening: Waiting for DTMF input (Press 1)
 * - processing: Waiting for voice input (name)
 * - transferring: Connecting to destination
 */
class IvrTransferAssistant extends BaseAssistant {
  private callerName: string = "";
  private transferInitiated: boolean = false;
  private contactMatcher: InstanceType<typeof ContactMatcher>;
  private retryManager: InstanceType<typeof RetryManager>;

  constructor(client: any, sessionId: string, contacts?: any) {
    super(ivrConfig, client, sessionId);
    this.contactMatcher = new ContactMatcher(contacts);
    this.retryManager = new RetryManager({
      maxRetries: this.config.behavior.maxRetries || 3,
      onMaxReached: () => {
        console.log(`[IvrTransfer][Session ${this.sessionId}] Max retries reached, hanging up`);
        this.hangup();
      },
    });
  }

  async onCallStart(channel: any, callerId: string, extension: string): Promise<void> {
    this.channel = channel;

    console.log(`[IvrTransfer][Session ${this.sessionId}] Call started from ${callerId} on ext ${extension}`);

    // Play welcome message: "Welcome. Press 1."
    this.setState("speaking" as AssistantState);

    try {
      await this.playAudio(this.config.prompts.welcome);
    } catch (err) {
      // Fallback to built-in sound if custom not available
      console.warn(`[IvrTransfer] Custom welcome not found, using fallback`);
      await this.playAudio("hello-world");
    }

    // Now waiting for DTMF "1"
    this.setState("listening" as AssistantState);
    this.playAudioNoWait("beep");
  }

  async onDTMFInput(digit: string): Promise<void> {
    console.log(`[IvrTransfer][Session ${this.sessionId}] DTMF: ${digit} (state: ${this.state})`);

    if (this.state === "listening" && digit === "1") {
      // User pressed 1 → prompt for name
      this.setState("speaking" as AssistantState);

      try {
        await this.playAudio(this.config.prompts.speakName);
      } catch (err) {
        console.warn(`[IvrTransfer] Custom speak-name prompt not found, using fallback`);
        await this.playAudio("beep");
      }

      // Now waiting for voice input (name)
      this.setState("processing" as AssistantState);
      this.playAudioNoWait("beep");

    } else if (this.state === "listening") {
      // Wrong key pressed
      this.playAudioNoWait("beep");
      this.retryManager.attempt();
    }
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    // Only process transcription when we're waiting for a name
    if (this.state !== "processing") {
      return;
    }

    console.log(`[IvrTransfer][Session ${this.sessionId}] Transcription (${isFinal ? "FINAL" : "interim"}): "${text}"`);

    // IMMEDIATE TRANSFER: Don't wait for final result
    // Transfer as soon as we have a substantial transcription (3+ chars)
    if (!this.transferInitiated && text.trim().length >= 3) {
      this.transferInitiated = true;
      this.callerName = text.trim();

      console.log(`[IvrTransfer][Session ${this.sessionId}] Name captured: "${this.callerName}" → Initiating transfer`);

      // Try contact matching first, fall back to destination transfer
      const matchedNumber = this.contactMatcher.findNumberByWords(text);
      if (matchedNumber !== "no-match") {
        console.log(`[IvrTransfer][Session ${this.sessionId}] Contact matched: ${matchedNumber}`);
        this.emit("contactMatched", {
          sessionId: this.sessionId,
          name: this.callerName,
          number: matchedNumber,
        });
        this.setState("transferring" as AssistantState);
        return;
      }

      // No contact match → transfer to configured destination
      this.emit("transferToDestination", {
        sessionId: this.sessionId,
        callerName: this.callerName,
      });

      this.setState("transferring" as AssistantState);
    }
  }

  async onCallEnd(channel: any): Promise<void> {
    console.log(`[IvrTransfer][Session ${this.sessionId}] Call ended. Caller name: "${this.callerName}"`);
    this.setState("idle" as AssistantState);
  }
}

module.exports.IvrTransferAssistant = IvrTransferAssistant;

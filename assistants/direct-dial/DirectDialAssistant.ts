const { BaseAssistant } = require("../base/BaseAssistant");
const { ContactMatcher } = require("../../tools/ContactMatcher");
const { RetryManager } = require("../../tools/RetryManager");

import type { AssistantConfig, AssistantState } from "../base/AssistantTypes";

const directDialConfig: AssistantConfig = require("./config.json");

/**
 * Direct Dial Assistant
 *
 * Replicates the original call flow:
 * 1. Play welcome prompt
 * 2. Listen for voice immediately (no DTMF gate)
 * 3. Match transcription against contacts (ContactMatcher)
 * 4. Match found → initiate outgoing call
 * 5. No match → beep, "try again" at intervals, hangup at max
 */
class DirectDialAssistant extends BaseAssistant {
  private contactMatcher: InstanceType<typeof ContactMatcher>;
  private retryManager: InstanceType<typeof RetryManager>;

  constructor(client: any, sessionId: string, contacts?: any) {
    super(directDialConfig, client, sessionId);
    this.contactMatcher = new ContactMatcher(contacts);
    this.retryManager = new RetryManager({
      maxRetries: (directDialConfig.behavior as any).maxNoMatches || 12,
      onMaxReached: () => {
        console.log(`[DirectDial][Session ${this.sessionId}] Max no-matches reached, hanging up`);
        this.hangup();
      },
      feedbackIntervals: [3, 6, 9],
      onFeedback: () => {
        this.playAudioNoWait(this.config.prompts.tryAgain);
      },
    });
  }

  async onCallStart(channel: any, callerId: string, extension: string): Promise<void> {
    this.channel = channel;

    console.log(`[DirectDial][Session ${this.sessionId}] Call started from ${callerId} on ext ${extension}`);

    // Play welcome message
    this.setState("speaking" as AssistantState);

    try {
      await this.playAudio(this.config.prompts.welcome);
    } catch (err) {
      console.warn(`[DirectDial] Custom welcome not found, using fallback`);
      await this.playAudio("hello-world");
    }

    // Immediately start listening for voice (no DTMF gate)
    this.setState("processing" as AssistantState);
    this.playAudioNoWait("beep");
  }

  async onDTMFInput(digit: string): Promise<void> {
    // No DTMF handling in this flow
    console.log(`[DirectDial][Session ${this.sessionId}] DTMF ignored: ${digit}`);
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    if (this.state !== "processing") {
      return;
    }

    console.log(`[DirectDial][Session ${this.sessionId}] Transcription (${isFinal ? "FINAL" : "interim"}): "${text}"`);

    const foundNumber = this.contactMatcher.findNumberByWords(text);
    console.log(`[DirectDial][Session ${this.sessionId}] Found number: ${foundNumber}`);

    if (foundNumber === "no-match") {
      this.playAudioNoWait("beep");
      this.retryManager.attempt();
    } else {
      console.log(`[DirectDial][Session ${this.sessionId}] Contact matched: ${foundNumber}`);
      this.setState("transferring" as AssistantState);
      this.emit("contactMatched", {
        sessionId: this.sessionId,
        name: text.trim(),
        number: foundNumber,
      });
    }
  }

  async onCallEnd(channel: any): Promise<void> {
    console.log(`[DirectDial][Session ${this.sessionId}] Call ended. Retries: ${this.retryManager.getCount()}`);
    this.setState("idle" as AssistantState);
  }
}

module.exports.DirectDialAssistant = DirectDialAssistant;

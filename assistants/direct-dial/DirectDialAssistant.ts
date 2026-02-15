const { BaseAssistant } = require("../base/BaseAssistant");
const { ContactMatcher } = require("../../tools/ContactMatcher");
const { RetryManager } = require("../../tools/RetryManager");
const { AssistantState } = require("../base/AssistantTypes");

import type { AssistantConfig } from "../base/AssistantTypes";
import type { ContactsData } from "../../tools/ContactMatcher";

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

  constructor(client: any, sessionId: string, contacts?: ContactsData) {
    super(directDialConfig, client, sessionId);
    this.contactMatcher = new ContactMatcher(contacts);

    const maxRetries = directDialConfig.behavior.maxNoMatches || 12;
    const interval = directDialConfig.behavior.tryAgainInterval || 3;

    this.retryManager = new RetryManager({
      maxRetries,
      onMaxReached: () => {
        console.log(`[DirectDial][Session ${this.sessionId}] Max no-matches reached, hanging up`);
        this.hangup();
      },
      feedbackIntervals: Array.from(
        { length: Math.floor(maxRetries / interval) - 1 },
        (_, i) => (i + 1) * interval
      ),
      onFeedback: () => {
        this.playAudioNoWait(this.config.prompts.tryAgain);
      },
    });
  }

  async onCallStart(channel: any, callerId: string, extension: string): Promise<void> {
    this.channel = channel;

    console.log(`[DirectDial][Session ${this.sessionId}] Call started from ${callerId} on ext ${extension}`);

    // Play welcome message
    this.setState(AssistantState.SPEAKING);
    await this.playAudioWithFallback(this.config.prompts.welcome, "hello-world");

    // Immediately start listening for voice (no DTMF gate)
    this.setState(AssistantState.PROCESSING);
    this.playAudioNoWait("beep");
  }

  async onDTMFInput(digit: string): Promise<void> {
    // No DTMF handling in this flow
    console.log(`[DirectDial][Session ${this.sessionId}] DTMF ignored: ${digit}`);
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    if (!this.isState(AssistantState.PROCESSING)) {
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
      this.setState(AssistantState.TRANSFERRING, foundNumber);
      this.emit("contactMatched", {
        sessionId: this.sessionId,
        name: text.trim(),
        number: foundNumber,
      });
    }
  }

  async onCallEnd(channel: any): Promise<void> {
    console.log(`[DirectDial][Session ${this.sessionId}] Call ended. Retries: ${this.retryManager.getCount()}`);
    this.setState(AssistantState.IDLE);
  }
}

module.exports.DirectDialAssistant = DirectDialAssistant;

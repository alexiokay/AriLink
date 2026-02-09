const { BaseAssistant } = require("../base/BaseAssistant");

import type { AssistantConfig, AssistantState } from "../base/AssistantTypes";

const directDialConfig: AssistantConfig = require("./config.json");

/**
 * Direct Dial Assistant
 *
 * Replicates the original call flow:
 * 1. Play welcome prompt
 * 2. Listen for voice immediately (no DTMF gate)
 * 3. Match transcription against contacts (findNumberByWords)
 * 4. Match found → initiate outgoing call
 * 5. No match → beep, "try again" at 3/6/9 attempts, hangup at 12
 */
class DirectDialAssistant extends BaseAssistant {
  private contacts: any;
  private noMatchCount: number = 0;

  constructor(client: any, sessionId: string, contacts?: any) {
    super(directDialConfig, client, sessionId);
    this.contacts = contacts;
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

    const foundNumber = this.findNumberByWords(text);
    console.log(`[DirectDial][Session ${this.sessionId}] Found number: ${foundNumber}`);

    if (foundNumber === "no-match") {
      this.noMatchCount++;
      this.playAudioNoWait("beep");

      if (this.noMatchCount === 3 || this.noMatchCount === 6 || this.noMatchCount === 9) {
        this.playAudioNoWait(this.config.prompts.tryAgain);
      } else if (this.noMatchCount >= 12) {
        console.log(`[DirectDial][Session ${this.sessionId}] No match 12 times, hanging up`);
        await this.hangup();
      }
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
    console.log(`[DirectDial][Session ${this.sessionId}] Call ended. No-match count: ${this.noMatchCount}`);
    this.setState("idle" as AssistantState);
  }

  /**
   * Finds a phone number based on matching words in a given text.
   */
  private findNumberByWords(searchWords: string): string {
    if (!this.contacts || !this.contacts.contacts) return "no-match";

    let foundNumber = "no-match";
    const searchWordList = searchWords
      .toLowerCase()
      .split(" ")
      .filter((word: string) => word !== "");
    const cleanedSearchWordList = searchWordList.map((word: string) =>
      word.split(".").join("")
    );

    for (const contact of this.contacts.contacts) {
      const { phone, words } = contact;

      const matchFound = words.some((contactWord: string) => {
        return cleanedSearchWordList.find(
          (word: string) => word === contactWord.toLowerCase()
        );
      });

      if (matchFound) {
        foundNumber = phone;
        break;
      }
    }

    return foundNumber;
  }
}

module.exports.DirectDialAssistant = DirectDialAssistant;

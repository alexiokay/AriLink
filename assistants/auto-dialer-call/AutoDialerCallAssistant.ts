const { BaseAssistant } = require("../base/BaseAssistant");
const { InactivityTimer } = require("../../tools/InactivityTimer");

import type { AssistantConfig, AssistantState } from "../base/AssistantTypes";

const dialerConfig: AssistantConfig = require("./config.json");

/**
 * Auto-Dialer Call Assistant
 *
 * Handles a single outbound auto-dialer call:
 * 1. Called party answers → play pre-recorded message
 * 2. Wait for DTMF input (default: press 1 to connect)
 * 3. If pressed → emit transferToDestination
 * 4. If timeout/no input → hang up, report "no_interest"
 *
 * No transcription needed.
 */
class AutoDialerCallAssistant extends BaseAssistant {
  private transferDigit: string;
  private result: string = "no_answer"; // default until updated
  private timer: InstanceType<typeof InactivityTimer>;

  constructor(client: any, sessionId: string) {
    super(dialerConfig, client, sessionId);
    this.transferDigit = (dialerConfig.behavior as any).transferDigit || "1";
    this.timer = new InactivityTimer(
      this.config.behavior.timeoutSeconds || 15,
      async () => {
        if (this.state === "listening") {
          console.log(`[AutoDialer][Session ${this.sessionId}] Timeout - no DTMF input`);
          this.result = "no_interest";

          try {
            await this.playAudio(this.config.prompts.goodbye);
          } catch {
            // Ignore if goodbye audio not found
          }

          await this.hangup();
        }
      }
    );
  }

  async onCallStart(channel: any, callerId: string, extension: string): Promise<void> {
    this.channel = channel;
    this.result = "answered";

    console.log(`[AutoDialer][Session ${this.sessionId}] Call answered by ${extension}`);

    // Play the campaign message
    this.setState("speaking" as AssistantState);

    try {
      await this.playAudio(this.config.prompts.welcome);
    } catch (err) {
      console.warn(`[AutoDialer][Session ${this.sessionId}] Welcome audio not found, using fallback`);
      await this.playAudio("beep");
    }

    // Now waiting for DTMF
    this.setState("listening" as AssistantState);
    this.timer.start();
  }

  async onDTMFInput(digit: string): Promise<void> {
    console.log(`[AutoDialer][Session ${this.sessionId}] DTMF: ${digit} (state: ${this.state})`);

    if (this.state !== "listening") return;

    this.timer.cancel();

    if (digit === this.transferDigit) {
      // Interested - transfer to destination
      this.result = "transferred";
      this.setState("transferring" as AssistantState);

      console.log(`[AutoDialer][Session ${this.sessionId}] Press ${digit} → transferring`);

      this.emit("transferToDestination", {
        sessionId: this.sessionId,
        callerName: "auto-dialer",
      });
    } else {
      // Wrong key - restart timeout
      this.timer.start();
    }
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    // Auto-dialer doesn't use transcription
  }

  async onCallEnd(channel: any): Promise<void> {
    this.timer.cancel();
    console.log(`[AutoDialer][Session ${this.sessionId}] Call ended. Result: ${this.result}`);
    this.setState("idle" as AssistantState);

    this.emit("callResult", {
      sessionId: this.sessionId,
      result: this.result,
    });
  }

  getResult(): string {
    return this.result;
  }

  destroy(): void {
    this.timer.cancel();
    super.destroy();
  }
}

module.exports.AutoDialerCallAssistant = AutoDialerCallAssistant;

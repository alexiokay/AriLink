const { BaseAssistant } = require("../base/BaseAssistant");
const { InactivityTimer } = require("../../tools/InactivityTimer");
const { AssistantState } = require("../base/AssistantTypes");

import type { AssistantConfig } from "../base/AssistantTypes";

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
    this.transferDigit = dialerConfig.behavior.transferDigit || "1";
    this.timer = new InactivityTimer(
      this.config.behavior.timeoutSeconds || 15,
      async () => {
        if (this.isState(AssistantState.LISTENING)) {
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
    this.setState(AssistantState.SPEAKING);
    await this.playAudioWithFallback(this.config.prompts.welcome, "beep");

    // Now waiting for DTMF
    this.setState(AssistantState.LISTENING);
    this.timer.start();
  }

  async onDTMFInput(digit: string): Promise<void> {
    console.log(`[AutoDialer][Session ${this.sessionId}] DTMF: ${digit} (state: ${this.state})`);

    if (!this.isState(AssistantState.LISTENING)) return;

    this.timer.cancel();

    if (digit === this.transferDigit) {
      // Interested - transfer to destination
      this.result = "transferred";
      this.setState(AssistantState.TRANSFERRING, "destination");

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
    this.setState(AssistantState.IDLE);

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

/**
 * OpenClaw Brain
 *
 * Thin bridge that forwards transcriptions to OpenClaw AI agent
 * via Socket.IO events. OpenClaw handles the "thinking" and
 * responds with text that gets synthesized via TTS.
 *
 * Flow:
 * 1. Call starts → emit openclawCallStarted
 * 2. Caller speaks → emit openclawTranscription
 * 3. OpenClaw responds → harness.speak(text) via TTS
 * 4. Call ends → emit openclawCallEnded
 */

const { AssistantState } = require("../base/AssistantTypes");

import type { IBrain, IBrainHarness } from "../base/BrainTypes";

class OpenClawBrain implements IBrain {
  private harness!: IBrainHarness;
  private callerId: string = "";

  init(harness: IBrainHarness): void {
    this.harness = harness;
  }

  async onCallStart(callerId: string, extension: string): Promise<void> {
    this.callerId = callerId;
    const sid = this.harness.sessionId;

    console.log(`[OpenClawBrain][Session ${sid}] Call from ${callerId} on ext ${extension}`);

    // Notify OpenClaw
    this.harness.emitEvent("openclawCallStarted", {
      sessionId: sid,
      callerId,
      extension,
    });

    // Play welcome audio (optional — OpenClaw may send its own greeting via TTS)
    this.harness.setState(AssistantState.SPEAKING);
    try {
      await this.harness.playAudio(this.harness.config.prompts.welcome);
    } catch {
      console.log(`[OpenClawBrain][Session ${sid}] No welcome audio — waiting for OpenClaw greeting`);
    }

    this.harness.setState(AssistantState.LISTENING);
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    if (!text.trim()) return;

    const sid = this.harness.sessionId;
    console.log(`[OpenClawBrain][Session ${sid}] Transcription (${isFinal ? "FINAL" : "interim"}): "${text}"`);

    // Forward ALL transcriptions to OpenClaw
    this.harness.emitEvent("openclawTranscription", {
      sessionId: sid,
      callId: sid,
      text: text.trim(),
      isFinal,
      callerNumber: this.callerId,
    });

    // Mark as processing when final (waiting for OpenClaw to respond)
    if (isFinal && text.trim().length >= 3) {
      this.harness.setState(AssistantState.PROCESSING);
    }
  }

  async onDTMFInput(digit: string): Promise<void> {
    const sid = this.harness.sessionId;
    console.log(`[OpenClawBrain][Session ${sid}] DTMF: ${digit}`);

    // Forward DTMF as special transcription
    this.harness.emitEvent("openclawTranscription", {
      sessionId: sid,
      callId: sid,
      text: `[DTMF: ${digit}]`,
      isFinal: true,
      callerNumber: this.callerId,
    });
  }

  onSpeakingDone(): void {
    if (this.harness.isState(AssistantState.SPEAKING)) {
      this.harness.setState(AssistantState.LISTENING);
    }
  }

  async onCallEnd(): Promise<void> {
    const sid = this.harness.sessionId;
    console.log(`[OpenClawBrain][Session ${sid}] Call ended`);

    this.harness.emitEvent("openclawCallEnded", {
      callId: sid,
      reason: "hangup",
    });
  }

  destroy(): void {
    // Nothing to clean up
  }
}

module.exports.OpenClawBrain = OpenClawBrain;

const { BaseAssistant } = require("../base/BaseAssistant");
const { AssistantState } = require("../base/AssistantTypes");

import type { AssistantConfig } from "../base/AssistantTypes";

const openclawConfig: AssistantConfig = require("./config.json");

/**
 * OpenClaw Assistant
 *
 * Bridges phone calls to an OpenClaw AI agent via Socket.IO.
 * The OpenClaw Channel Plugin (@openclaw/arilink) connects
 * to AriLink and receives transcription events from this assistant.
 *
 * Call flow:
 * 1. Call arrives → play greeting (or OpenClaw's configured greeting via TTS)
 * 2. Caller speaks → Parakeet transcribes
 * 3. Transcription emitted to OpenClaw via "openclaw:transcription" event
 * 4. OpenClaw AI generates response
 * 5. OpenClaw sends "openclaw:speak" → TTS → audio played to caller
 * 6. Loop until call ends or OpenClaw hangs up
 *
 * States:
 * - idle: No active call
 * - listening: Waiting for caller to speak
 * - processing: Transcription sent to OpenClaw, waiting for response
 * - speaking: Playing TTS response to caller
 */
class OpenClawAssistant extends BaseAssistant {
  private callerId: string = "";
  private extension: string = "";

  constructor(client: any, sessionId: string) {
    super(openclawConfig, client, sessionId);
  }

  async onCallStart(
    channel: any,
    callerId: string,
    extension: string
  ): Promise<void> {
    this.channel = channel;
    this.callerId = callerId;
    this.extension = extension;

    console.log(
      `[OpenClaw][Session ${this.sessionId}] Call started from ${callerId} on ext ${extension}`
    );

    // Notify OpenClaw that a new call has started
    this.emit("openclawCallStarted", {
      sessionId: this.sessionId,
      callerId,
      extension,
    });

    // Play welcome audio (falls back to beep if custom audio not uploaded)
    this.setState(AssistantState.SPEAKING);
    try {
      await this.playAudio(this.config.prompts.welcome);
    } catch {
      // No custom welcome file — OpenClaw will send its own greeting via TTS
      console.log(
        `[OpenClaw][Session ${this.sessionId}] No welcome audio — waiting for OpenClaw greeting`
      );
    }

    // Start listening for caller speech
    this.setState(AssistantState.LISTENING);
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    if (!text.trim()) return;

    console.log(
      `[OpenClaw][Session ${this.sessionId}] Transcription (${isFinal ? "FINAL" : "interim"}): "${text}"`
    );

    // Forward ALL transcriptions to OpenClaw (both interim and final)
    // The OpenClaw plugin decides which ones to process
    this.emit("openclawTranscription", {
      sessionId: this.sessionId,

      text: text.trim(),
      isFinal,
      callerNumber: this.callerId,
    });

    // Mark as processing when we get a final result (waiting for OpenClaw to respond)
    if (isFinal && text.trim().length >= 3) {
      this.setState(AssistantState.PROCESSING);
    }
  }

  async onDTMFInput(digit: string): Promise<void> {
    console.log(
      `[OpenClaw][Session ${this.sessionId}] DTMF: ${digit}`
    );

    // Forward DTMF to OpenClaw as a special transcription
    this.emit("openclawTranscription", {
      sessionId: this.sessionId,

      text: `[DTMF: ${digit}]`,
      isFinal: true,
      callerNumber: this.callerId,
    });
  }

  /**
   * Called by AriControllerServer when OpenClaw sends a "speak" command.
   * Plays TTS audio to the caller.
   */
  async onOpenClawSpeak(text: string): Promise<void> {
    if (!this.channel) return;

    console.log(
      `[OpenClaw][Session ${this.sessionId}] Speaking: "${text.substring(0, 80)}${text.length > 80 ? "..." : ""}"`
    );

    this.setState(AssistantState.SPEAKING);

    // Emit event for TTS — the controller will handle actual synthesis
    this.emit("openclawSpeak", {
      sessionId: this.sessionId,
      text,
    });
  }

  /**
   * Called when TTS playback finishes — go back to listening.
   */
  onSpeakingDone(): void {
    if (this.isState(AssistantState.SPEAKING)) {
      this.setState(AssistantState.LISTENING);
    }
  }

  async onCallEnd(channel: any): Promise<void> {
    console.log(
      `[OpenClaw][Session ${this.sessionId}] Call ended. Caller: ${this.callerId}`
    );

    // Notify OpenClaw
    this.emit("openclawCallEnded", {
      sessionId: this.sessionId,

      reason: "hangup",
    });

    this.setState(AssistantState.IDLE);
  }
}

module.exports.OpenClawAssistant = OpenClawAssistant;

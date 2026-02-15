const EventEmitter = require("events");
const { AssistantState: _AssistantState } = require("./AssistantTypes");

import type { IAssistant, AssistantConfig, AssistantState } from "./AssistantTypes";

abstract class BaseAssistant extends EventEmitter implements IAssistant {
  protected config: AssistantConfig;
  protected state: AssistantState = _AssistantState.IDLE;
  protected channel: any;
  protected client: any; // ARI client reference
  protected sessionId: string;

  constructor(config: AssistantConfig, client: any, sessionId: string) {
    super();
    this.validateConfig(config);
    this.config = config;
    this.client = client;
    this.sessionId = sessionId;
  }

  private validateConfig(config: AssistantConfig): void {
    if (!config.name) {
      throw new Error("Assistant config missing 'name'");
    }
    if (!config.prompts || typeof config.prompts !== "object") {
      throw new Error(`[${config.name}] Config missing 'prompts' object`);
    }
    if (!config.prompts.welcome) {
      console.warn(`[${config.name}] Config missing 'prompts.welcome' - fallback audio will be used`);
    }
    if (!config.behavior || typeof config.behavior !== "object") {
      throw new Error(`[${config.name}] Config missing 'behavior' object`);
    }
  }

  async playAudio(audioFile: string): Promise<void> {
    if (!this.channel) {
      console.error(`[${this.config.name}] No channel available for playback`);
      return;
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let started = false;
      let settled = false;
      let startTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      };

      this.channel.play(
        { media: `sound:${audioFile}` },
        (err: any, playback: any) => {
          if (err) {
            console.error(`[${this.config.name}] Error playing ${audioFile}:`, err);
            return reject(err);
          }
          console.log(`[${this.config.name}] Playing: ${audioFile}`);

          // Safety net: if PlaybackStarted never fires within 3s, the file
          // is missing and Asterisk silently dropped the playback.
          // This is NOT a playback duration limit — real audio can be any length.
          startTimer = setTimeout(() => {
            if (!started && !settled) {
              settled = true;
              console.warn(`[${this.config.name}] No PlaybackStarted for ${audioFile} after 3s — file likely missing`);
              reject(new Error(`Playback never started: ${audioFile}`));
            }
          }, 3000);

          playback.once("PlaybackStarted", () => {
            started = true;
            if (startTimer) { clearTimeout(startTimer); startTimer = null; }
          });

          playback.once("PlaybackFinished", () => {
            cleanup();
            if (settled) return;
            settled = true;

            const duration = Date.now() - startTime;
            console.log(`[${this.config.name}] Finished: ${audioFile} (${duration}ms)`);

            // No real audio file plays in under 100ms — file is missing, empty, or corrupt.
            // Asterisk sometimes sends PlaybackStarted+PlaybackFinished instantly for broken files.
            if (duration < 100) {
              return reject(new Error(`Audio file not found or failed to play: ${audioFile}`));
            }

            resolve();
          });
        }
      );
    });
  }

  async playAudioNoWait(audioFile: string): Promise<void> {
    if (!this.channel) {
      console.error(`[${this.config.name}] No channel available for playback`);
      return;
    }

    this.channel.play(
      { media: `sound:${audioFile}` },
      (err: any, playback: any) => {
        if (err) {
          console.error(`[${this.config.name}] Error playing ${audioFile}:`, err);
          return;
        }
        console.log(`[${this.config.name}] Playing: ${audioFile}`);
      }
    );
  }

  async transferCall(endpoint: string): Promise<void> {
    console.log(`[${this.config.name}] Transferring to ${endpoint}`);
    this.setState(_AssistantState.TRANSFERRING, endpoint);
    this.emit("transfer", { endpoint, sessionId: this.sessionId });
  }

  async hangup(): Promise<void> {
    if (this.channel) {
      this.channel.hangup((err: any) => {
        if (err) console.error(`[${this.config.name}] Hangup error:`, err);
      });
    }
  }

  getConfig(): AssistantConfig {
    return this.config;
  }

  getState(): AssistantState {
    return this.state;
  }

  setState(state: AssistantState, detail?: string): void {
    const prev = this.state;
    this.state = state;
    console.log(`[${this.config.name}][Session ${this.sessionId}] State: ${prev} → ${state}${detail ? ` (${detail})` : ""}`);
    this.emit("stateChange", { sessionId: this.sessionId, prev, state, detail });
  }

  protected async playAudioWithFallback(primary: string, fallback: string): Promise<void> {
    try {
      await this.playAudio(primary);
    } catch {
      console.warn(`[${this.config.name}] ${primary} not found, using fallback: ${fallback}`);
      await this.playAudio(fallback);
    }
  }

  protected isState(...states: AssistantState[]): boolean {
    return states.includes(this.state);
  }

  destroy(): void {
    this.removeAllListeners();
    this.channel = null;
    this.client = null;
  }

  // Abstract methods - must be implemented by subclasses
  abstract onCallStart(channel: any, callerId: string, extension: string): Promise<void>;
  abstract onTranscription(text: string, isFinal: boolean): Promise<void>;
  abstract onDTMFInput(digit: string): Promise<void>;
  abstract onCallEnd(channel: any): Promise<void>;
}

module.exports.BaseAssistant = BaseAssistant;

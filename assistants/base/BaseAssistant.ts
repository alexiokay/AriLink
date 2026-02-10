const EventEmitter = require("events");

import type { IAssistant, AssistantConfig, AssistantState } from "./AssistantTypes";

abstract class BaseAssistant extends EventEmitter implements IAssistant {
  protected config: AssistantConfig;
  protected state: string = "idle"; // AssistantState.IDLE
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

      this.channel.play(
        { media: `sound:${audioFile}` },
        (err: any, playback: any) => {
          if (err) {
            console.error(`[${this.config.name}] Error playing ${audioFile}:`, err);
            return reject(err);
          }
          console.log(`[${this.config.name}] Playing: ${audioFile}`);

          playback.once("PlaybackFinished", () => {
            const duration = Date.now() - startTime;
            console.log(`[${this.config.name}] Finished: ${audioFile} (${duration}ms)`);

            // If playback finished in less than 100ms, the file likely doesn't exist
            // Even the shortest audio files take longer than this to play
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
    this.setState("transferring" as AssistantState);
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
    return this.state as AssistantState;
  }

  setState(state: AssistantState): void {
    const prev = this.state;
    this.state = state as string;
    console.log(`[${this.config.name}][Session ${this.sessionId}] State: ${prev} → ${state}`);
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

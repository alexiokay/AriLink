/**
 * LLM Chat Brain
 *
 * Conversational AI brain that sends transcriptions directly to an
 * LLM API (OpenAI-compatible) and speaks the response via TTS.
 * No external orchestrator needed — AriLink is the brain.
 *
 * Supports: Ollama, LM Studio, OpenAI, Anthropic (via proxy), vLLM,
 * or any OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Flow:
 * 1. Call starts → play welcome / speak greeting
 * 2. Caller speaks → STT → BrainHarness filters fillers + debounces turns
 * 3. Clean turn arrives → stream LLM response, speak each sentence as it arrives
 * 4. First sentence plays in ~0.5s instead of ~2s (streaming pipeline)
 * 5. Loop until call ends or silence timeout
 *
 * Config (in assistant config.json "behavior"):
 *   llmProvider  — provider preset: "ollama" | "gemini" | "openai" | "openrouter" | "custom"
 *   llmEndpoint  — API base URL (auto-set from provider, or custom URL)
 *   llmModel     — model name (default depends on provider)
 *   llmApiKey    — API key (optional for ollama, required for cloud)
 *   systemPrompt — system message for the LLM
 *   maxHistory   — max conversation turns to keep (default: 20)
 *   temperature  — LLM temperature (default: 0.7)
 *   maxTokens    — max response tokens (default: 400)
 *   silenceTimeoutSec    — seconds before "are you there?" reprompt (default: 15)
 *   maxSilenceReprompts  — reprompts before hangup (default: 2)
 *   turnDebounceMs       — ms to wait for continuation after is_final (default: 600, read by BrainHarness)
 *
 * Env var overrides: LLM_PROVIDER, LLM_ENDPOINT, LLM_MODEL, LLM_API_KEY
 *
 * Provider presets (auto-configures endpoint + default model):
 *   ollama      → http://localhost:11434/v1/chat/completions  (llama3.2)
 *   gemini      → generativelanguage.googleapis.com           (gemini-3-flash-preview)
 *   openai      → api.openai.com                              (gpt-4o-mini)
 *   openrouter  → openrouter.ai                               (anthropic/claude-sonnet-4-20250514)
 *   custom      → use llmEndpoint as-is
 */

const { AssistantState } = require("../base/AssistantTypes");

import type { IBrain, IBrainHarness } from "../base/BrainTypes";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Provider presets: endpoint URL + chat completions path + default model
const PROVIDERS: Record<string, { url: string; path: string; model: string }> = {
  ollama: {
    url: "http://localhost:11434",
    path: "/v1/chat/completions",
    model: "llama3.2",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com",
    path: "/v1beta/openai/chat/completions",
    model: "gemini-3-flash-preview",
  },
  openai: {
    url: "https://api.openai.com",
    path: "/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  openrouter: {
    url: "https://openrouter.ai/api",
    path: "/v1/chat/completions",
    model: "anthropic/claude-sonnet-4-20250514",
  },
};

class LlmChatBrain implements IBrain {
  private harness!: IBrainHarness;
  private history: ChatMessage[] = [];
  private processing = false;
  private streaming = false; // true while inside streamAndSpeak loop
  private pendingText: string | null = null; // latest user input during processing (last-write-wins)

  // Silence timeout: reprompt or hang up when caller goes silent
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceRepromptCount = 0;

  // Barge-in: abort the current LLM fetch when the user interrupts
  private currentAbortController: AbortController | null = null;

  // Resolved config (merged from config.json + env vars)
  private completionsUrl = "";
  private model = "";
  private apiKey = "";
  private systemPrompt = "";
  private maxHistory = 20;
  private temperature = 0.7;
  private maxTokens = 400;
  private silenceTimeoutSec = 15;
  private maxSilenceReprompts = 2;

  init(harness: IBrainHarness): void {
    this.harness = harness;
    const b: any = harness.config.behavior || {};

    const envProvider = process.env.LLM_PROVIDER;
    const provider = (envProvider || b.llmProvider || "ollama").toLowerCase();
    const preset = PROVIDERS[provider];

    // If the provider was overridden by env var (different from config), ignore
    // config.json's model — it's likely for a different provider (e.g. "llama3.2" for ollama)
    const providerOverridden = envProvider && envProvider.toLowerCase() !== (b.llmProvider || "ollama").toLowerCase();

    if (preset) {
      // Provider preset — auto-configure endpoint + model
      const baseUrl = (process.env.LLM_ENDPOINT || b.llmEndpoint || preset.url).replace(/\/$/, "");
      this.completionsUrl = baseUrl + preset.path;
      this.model = process.env.LLM_MODEL
        || (providerOverridden ? preset.model : (b.llmModel || preset.model));
    } else {
      // Custom — user provides full endpoint, we append /v1/chat/completions
      const baseUrl = (process.env.LLM_ENDPOINT || b.llmEndpoint || "http://localhost:11434").replace(/\/$/, "");
      this.completionsUrl = baseUrl + "/v1/chat/completions";
      this.model = process.env.LLM_MODEL
        || (providerOverridden ? "llama3.2" : (b.llmModel || "llama3.2"));
    }

    this.apiKey = process.env.LLM_API_KEY || b.llmApiKey || "";
    const basePrompt =
      b.systemPrompt ||
      "You are a helpful phone assistant. Keep responses short (1-2 sentences) and conversational. Do not use markdown, lists, or formatting — the response will be spoken aloud.";
    // Append barge-in guidance so the LLM handles interrupted responses naturally.
    // Messages marked "[interrupted by user]" appear in history when barge-in occurs.
    this.systemPrompt = basePrompt +
      "\n\nWhen your previous message shows \"[interrupted by user]\", it means the caller spoke over you. " +
      "If their response is a short acknowledgment (like \"yeah\", \"okay\", \"mhm\", \"continue\"), " +
      "seamlessly continue where you left off. If they said something new, respond to that instead.";
    this.maxHistory = b.maxHistory || 20;
    this.temperature = b.temperature ?? 0.7;
    this.maxTokens = b.maxTokens || 400;
    this.silenceTimeoutSec = b.silenceTimeoutSec || 15;
    this.maxSilenceReprompts = b.maxSilenceReprompts ?? 2;
  }

  async onCallStart(callerId: string, extension: string): Promise<void> {
    const sid = this.harness.sessionId;
    console.log(`[LlmChat][Session ${sid}] Call from ${callerId} on ext ${extension}`);
    console.log(`[LlmChat][Session ${sid}] LLM: ${this.completionsUrl} model=${this.model}`);

    // Reset conversation
    this.history = [{ role: "system", content: this.systemPrompt }];
    this.processing = false;
    this.silenceRepromptCount = 0;

    // Play welcome audio if configured, otherwise speak a greeting
    const welcomePrompt = this.harness.config.prompts?.welcome;
    if (welcomePrompt) {
      this.harness.setState(AssistantState.SPEAKING);
      try {
        await this.harness.playAudio(welcomePrompt);
      } catch {
        // No audio file — speak a greeting instead
        await this.harness.speak("Hello, how can I help you?");
        this.resetSilenceTimer();
        return; // speak() sets state to SPEAKING, onSpeakingDone will set LISTENING
      }
    } else {
      await this.harness.speak("Hello, how can I help you?");
      this.resetSilenceTimer();
      return;
    }

    this.harness.setState(AssistantState.LISTENING);
    this.resetSilenceTimer();
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    // BrainHarness handles: filler filtering, turn debouncing, barge-in debounce.
    // By the time we get here, text is clean and debounced.
    if (!isFinal || !text.trim()) return;

    const sid = this.harness.sessionId;
    const trimmed = text.trim();

    // Reset silence timer — caller is still there
    this.resetSilenceTimer();
    this.silenceRepromptCount = 0;

    // If already processing, keep only the LATEST input (last-write-wins).
    if (this.processing) {
      console.log(`[LlmChat][Session ${sid}] Queued (processing): "${trimmed}"`);
      this.pendingText = trimmed;
      return;
    }

    await this.processUserInput(trimmed, sid);
  }

  private async processUserInput(text: string, sid: string): Promise<void> {
    console.log(`[LlmChat][Session ${sid}] User: "${text}"`);

    this.processing = true;
    this.harness.setState(AssistantState.PROCESSING);

    // Add user message to history
    this.history.push({ role: "user", content: text });
    this.trimHistory();

    let bargedIn = false;
    try {
      await this.streamAndSpeak(sid);
    } catch (err: any) {
      if (err?.name === "BargeInError" || err?.name === "AbortError") {
        // Barge-in interrupted the LLM stream — don't retry, don't speak error.
        // The interrupting text will arrive via onTranscription → pendingText.
        console.log(`[LlmChat][Session ${sid}] Stream interrupted by barge-in`);
        // Remove the partial assistant response from history (last push was user msg)
        // streamAndSpeak didn't push to history on barge-in, so nothing to remove
        bargedIn = true;
      } else {
        console.error(`[LlmChat][Session ${sid}] LLM error: ${err.message}`);

        // Retry once with backoff for transient errors (429, 503, network)
        try {
          console.log(`[LlmChat][Session ${sid}] Retrying LLM call after 1s...`);
          await new Promise((r) => setTimeout(r, 1000));
          await this.streamAndSpeak(sid);
        } catch (retryErr: any) {
          if (retryErr?.name === "BargeInError" || retryErr?.name === "AbortError") {
            bargedIn = true;
          } else {
            console.error(`[LlmChat][Session ${sid}] LLM retry failed: ${retryErr.message}`);
            await this.harness.speak("Sorry, I had trouble processing that. Could you try again?");
          }
        }
      }
    }

    // Farewell detection: if the bot's response ends with goodbye/bye,
    // the conversation is over — hang up instead of waiting for silence timeout.
    if (!bargedIn && this.isFarewellResponse()) {
      console.log(`[LlmChat][Session ${sid}] Bot said goodbye — hanging up`);
      this.processing = false;
      this.clearTimers();
      try { await this.harness.hangup(); } catch {}
      return;
    }

    // Check for queued input that arrived while we were processing
    // (includes barge-in text forwarded by AriControllerServer)
    if (this.pendingText) {
      const queued = this.pendingText;
      this.pendingText = null;
      console.log(`[LlmChat][Session ${sid}] Processing ${bargedIn ? "barge-in" : "queued"} input: "${queued}"`);
      await this.processUserInput(queued, sid);
      return; // processUserInput handles setting LISTENING when done
    }

    // All sentences spoken, no pending input — ready for next turn
    this.processing = false;
    this.harness.setState(AssistantState.LISTENING);
    this.resetSilenceTimer();
  }

  /**
   * Stream LLM response and speak each sentence as it arrives.
   * First sentence plays in ~0.3-0.5s instead of waiting for full response (~1.5s).
   */
  private async streamAndSpeak(sid: string): Promise<void> {
    this.streaming = true;
    const url = this.completionsUrl;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.model,
      messages: this.history,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
    };

    const controller = new AbortController();
    this.currentAbortController = controller;

    // Inactivity timeout — aborts if the LLM stops sending data for 10s.
    // Paused during speak() so TTS playback time doesn't count.
    const INACTIVITY_MS = 10_000;
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    const resetInactivity = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => controller.abort(), INACTIVITY_MS);
    };
    const pauseInactivity = () => {
      if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
    };

    // Start the inactivity clock (covers initial fetch + first chunk)
    resetInactivity();

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`LLM API returned ${res.status}: ${errorText.substring(0, 200)}`);
      }

      // First chunk arrived — reset the inactivity clock
      resetInactivity();

      // Parse SSE stream and speak sentences as they arrive
      let fullResponse = "";
      let sentenceBuffer = "";
      let sentenceCount = 0;
      let bargedIn = false;
      const spokenSentences: string[] = []; // track what was actually spoken (for barge-in context)

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Data received from LLM — reset inactivity timer
        resetInactivity();

        sseBuffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || ""; // Keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;
            if (!token) continue;

            sentenceBuffer += token;
            fullResponse += token;

            // Check for sentence boundary: .!? followed by space or end
            const sentenceMatch = sentenceBuffer.match(/^(.*?[.!?])(\s+|$)(.*)/s);
            if (sentenceMatch) {
              const sentence = sentenceMatch[1].trim();
              sentenceBuffer = sentenceMatch[3] || "";

              if (sentence.length > 0) {
                sentenceCount++;
                const label = sentenceCount === 1 ? "(first)" : `(#${sentenceCount})`;
                console.log(`[LlmChat][Session ${sid}] Streaming ${label}: "${sentence}"`);
                // Pause inactivity during TTS — playback can take many seconds
                pauseInactivity();
                try {
                  await this.harness.speak(sentence);
                  spokenSentences.push(sentence);
                } catch (speakErr: any) {
                  if (speakErr?.name === "BargeInError") {
                    console.log(`[LlmChat][Session ${sid}] Barge-in interrupted streaming`);
                    bargedIn = true;
                    reader.cancel().catch(() => {});
                    break;
                  }
                  throw speakErr; // re-throw non-barge-in errors
                }
                // Resume inactivity timer for the next LLM chunk
                resetInactivity();
              }
            }
          } catch (parseErr: any) {
            if (parseErr?.name === "BargeInError") throw parseErr;
            // Skip malformed JSON chunks
          }
        }
        if (bargedIn) break;
      }

      // If barge-in interrupted, save what was spoken for context
      if (bargedIn) {
        const spokenText = spokenSentences.join(" ");
        console.log(`[LlmChat][Session ${sid}] Barge-in: ${spokenSentences.length} sentences spoken, interrupted`);

        // Add partial response to conversation history so the LLM knows
        // what it was saying when the user interrupted
        if (spokenText) {
          this.history.push({
            role: "assistant",
            content: spokenText + " [interrupted by user]",
          });
        }
        return;
      }

      // Speak any remaining text that didn't end with punctuation
      if (sentenceBuffer.trim().length > 0) {
        sentenceCount++;
        console.log(`[LlmChat][Session ${sid}] Streaming (final): "${sentenceBuffer.trim()}"`);
        pauseInactivity();
        try {
          await this.harness.speak(sentenceBuffer.trim());
        } catch (speakErr: any) {
          if (speakErr?.name === "BargeInError") {
            console.log(`[LlmChat][Session ${sid}] Barge-in interrupted final sentence`);
            const spokenText = spokenSentences.join(" ");
            if (spokenText) {
              this.history.push({
                role: "assistant",
                content: spokenText + " [interrupted by user]",
              });
            }
            return;
          }
          throw speakErr;
        }
      }

      const trimmed = fullResponse.trim();
      if (!trimmed) throw new Error("LLM returned empty response");

      console.log(`[LlmChat][Session ${sid}] Assistant: "${trimmed.substring(0, 100)}${trimmed.length > 100 ? "..." : ""}" (${sentenceCount} sentences streamed)`);
      this.history.push({ role: "assistant", content: trimmed });
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      this.currentAbortController = null;
      this.streaming = false;
    }
  }

  async onDTMFInput(digit: string): Promise<void> {
    const sid = this.harness.sessionId;
    console.log(`[LlmChat][Session ${sid}] DTMF: ${digit}`);

    this.resetSilenceTimer();
    this.silenceRepromptCount = 0;

    // Treat DTMF as text input
    if (!this.processing) {
      this.processing = true;
      this.harness.setState(AssistantState.PROCESSING);
      this.history.push({ role: "user", content: `[The caller pressed key ${digit} on their phone]` });
      this.trimHistory();

      try {
        await this.streamAndSpeak(sid);
      } catch (err: any) {
        if (err?.name === "BargeInError") {
          console.log(`[LlmChat][Session ${sid}] DTMF response interrupted by barge-in`);
        } else {
          console.error(`[LlmChat][Session ${sid}] LLM error on DTMF: ${err.message}`);
        }
      }

      this.processing = false;
      this.harness.setState(AssistantState.LISTENING);
      this.resetSilenceTimer();
    }
  }

  onSpeakingDone(): void {
    // During streaming, each sentence triggers onSpeakingDone when its TTS
    // finishes. Do NOT reset state or processing — the streaming loop is
    // still running and will send more sentences. Only processUserInput()
    // resets these after streamAndSpeak() fully completes.
    if (this.streaming) return;

    // Non-streaming path (welcome greeting, error message, etc.)
    if (this.harness.isState(AssistantState.SPEAKING)) {
      this.processing = false;
      this.harness.setState(AssistantState.LISTENING);
    }
  }

  onBargeIn(text: string): void {
    const sid = this.harness.sessionId;
    console.log(`[LlmChat][Session ${sid}] Barge-in received: "${text}"`);

    // Abort the in-flight LLM fetch so the streaming loop exits.
    // BrainHarness handles: lastBargeInAtMs tracking, debounce timer clearing.
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
  }

  async onCallEnd(): Promise<void> {
    const sid = this.harness.sessionId;
    const turns = this.history.filter((m) => m.role === "user").length;
    console.log(`[LlmChat][Session ${sid}] Call ended after ${turns} user turns`);
    this.clearTimers();
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this.history = [];
    this.processing = false;
    this.pendingText = null;
  }

  destroy(): void {
    this.clearTimers();
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this.history = [];
    this.pendingText = null;
  }

  // ── Private ──

  /**
   * Check if the bot's last response is a farewell (ends with goodbye/bye).
   * When the LLM decides to say goodbye, we should hang up the call.
   */
  private isFarewellResponse(): boolean {
    const last = this.history[this.history.length - 1];
    if (last?.role !== "assistant") return false;
    // Check if the response ends with a farewell phrase
    const trimmed = last.content.trim().toLowerCase();
    return /\b(goodbye!?|bye!?|bye bye!?|farewell!?|do widzenia!?)\s*$/.test(trimmed);
  }

  private trimHistory(): void {
    // Keep system message + last N turns (user+assistant pairs)
    const systemMsg = this.history[0];
    const rest = this.history.slice(1);

    if (rest.length > this.maxHistory * 2) {
      this.history = [systemMsg, ...rest.slice(-this.maxHistory * 2)];
    }
  }

  /**
   * Reset the silence timer. Called after any caller activity (speech, DTMF)
   * and after bot finishes speaking.
   */
  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.silenceTimeoutSec <= 0) return; // disabled

    this.silenceTimer = setTimeout(() => {
      this.onSilenceTimeout();
    }, this.silenceTimeoutSec * 1000);
  }

  /**
   * Called when the caller has been silent for silenceTimeoutSec.
   * Reprompts up to maxSilenceReprompts times, then says goodbye.
   */
  private async onSilenceTimeout(): Promise<void> {
    if (this.processing || this.streaming) return; // bot is busy, not a real silence

    const sid = this.harness.sessionId;
    this.silenceRepromptCount++;

    if (this.silenceRepromptCount <= this.maxSilenceReprompts) {
      console.log(`[LlmChat][Session ${sid}] Silence timeout — reprompt #${this.silenceRepromptCount}`);
      try {
        await this.harness.speak("Are you still there?");
      } catch (err: any) {
        if (err?.name === "BargeInError") return; // user interrupted reprompt — good, they're back
        throw err;
      }
      this.resetSilenceTimer();
    } else {
      console.log(`[LlmChat][Session ${sid}] Silence timeout — max reprompts reached, ending call`);
      try {
        await this.harness.speak("It seems like you're no longer there. Goodbye!");
      } catch (err: any) {
        if (err?.name === "BargeInError") {
          // User said "wait!" during goodbye — cancel the hangup, they're back
          console.log(`[LlmChat][Session ${sid}] Barge-in during goodbye — cancelling hangup`);
          this.silenceRepromptCount = 0;
          this.resetSilenceTimer();
          return;
        }
        throw err;
      }
      try { await this.harness.hangup(); } catch {}
    }
  }

  private clearTimers(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
}

module.exports.LlmChatBrain = LlmChatBrain;

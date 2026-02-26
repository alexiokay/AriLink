# AriLink TODO

## Priority 1: Telephony & Conversation Quality (AriLink's Job)

These are telephony-layer features that only AriLink can handle — no brain or external AI can do this.

### False Interruption Recovery
- [ ] **Resume interrupted speech** — if VAD fires but no transcription arrives within timeout (~1.5s), auto-resume speaking the interrupted response (LiveKit pattern). Currently barge-in cancels speech permanently even on false triggers.
- [ ] **Semantic turn detection** — beyond VAD silence, analyze partial transcript for end-of-turn signals (question marks, complete sentences). Reduces false interruptions.

### Warm Transfer with Context
- [ ] **Conversation summary on transfer** — when transferring to human (3CX), pass full conversation summary so caller doesn't repeat themselves. Build summary from LLM history or OpenClaw context.

### Voicemail Detection
- [ ] **AMD (Answering Machine Detection)** — for outbound campaigns, detect voicemail greeting and either leave a message or retry later. Can use Asterisk's built-in AMD or STT-based detection.

### Per-Agent Behavior Config
Config already partially wired — `turnDebounceMs` (BrainHarness) and `maxTokens` (LlmChatBrain) work. Still need:
```json
{
  "behavior": {
    "systemPrompt": "You are a pizza ordering assistant...",
    "bargeInMode": "acknowledge",
    "responseLength": "short",
    "turnDebounceMs": 300,
    "maxTokens": 400,
    "allowedTopics": ["ordering", "menu", "delivery"]
  }
}
```
- [x] **`turnDebounceMs`** — per-agent debounce (default 300ms) — wired in BrainHarness
- [x] **`maxTokens`** — per-agent token limit — wired in LlmChatBrain
- [ ] **`bargeInMode`** — `"acknowledge"` (respond to interruption) | `"continue"` (resume where interrupted) | `"ignore"` (no barge-in guidance). Currently hardcoded "acknowledge" in LlmChatBrain system prompt.
- [ ] **`responseLength`** — `"short"` (1-2 sentences) | `"medium"` (3-5) | `"long"` (stories/explanations). Currently hardcoded "short" in default system prompt.
- [ ] **`allowedTopics`** — constrain conversation scope (safety injection in system prompt)
- [ ] Move hardcoded barge-in prompt into config-driven logic

## Priority 2: Campaign & Outbound

Basic campaign engine (AutoDialer) works with maxConcurrent pacing. Still need:

- [x] Call pacing (maxConcurrent outbound calls) — wired in AutoDialer
- [ ] Retry failed/no-answer calls (configurable max retries + backoff)
- [ ] Time-of-day restrictions (business hours only, per timezone)
- [ ] DNC (Do Not Call) suppression list
- [ ] Caller ID per campaign (currently uses default)
- [ ] Campaign analytics (connect rate, avg duration, outcomes)
- [ ] OpenClaw outbound dialing (stubbed in brain, needs implementation)

## Priority 3: Dashboard & UX

- [x] **Routing UI** — extension + caller ID routing editor in config page
- [ ] **WebRTC softphone** — phone widget in dashboard for testing calls without a real phone
- [ ] **FreePBX setup wizard** — auto-configure via fwconsole REST API
- [ ] **Agent template marketplace** — pre-built agents (restaurant, clinic, support, appointment booking)
- [ ] **Config hot-reload** — apply config changes to active calls without restart

## Priority 4: Analytics & Monitoring

- [ ] **Latency metrics** — p50/p95 voice-to-voice response time per call
- [ ] **Call recordings with playback** — replay calls with transcript overlay
- [ ] **Task completion rate** — did the agent achieve its goal?
- [ ] **A/B testing** — compare different system prompts on real calls

## Priority 5: Infrastructure

- [x] Transcription WebSocket auto-reconnect
- [x] ARI connection auto-reconnect
- [ ] Max concurrent session limit (global, not per-campaign)
- [ ] Session timeout cleanup (orphaned sessions)
- [ ] Unit tests with mock ARI client
- [ ] Call recording storage (S3 / local)
- [ ] Multi-region deployment support

---

## Outsourceable to OpenClaw

These features are handled by OpenClaw when using OpenClawBrain. Only needed in AriLink for standalone LlmChatBrain users — lower priority since OpenClaw integration exists.

### Tool Use (MCP)
- [ ] MCP client in LlmChatBrain — connect to MCP servers listed in agent's `config.json`
- [ ] Tool execution loop — LLM returns `tool_calls` → execute via MCP → feed results back → loop
- [ ] Progress speech — "Let me check that for you..." when tool call takes >1s
- [ ] Built-in telephony tools: `transfer_to_human`, `hangup`, `send_sms` (these ARE AriLink's job even with OpenClaw)
- [ ] Tool timeout + fallback speech
- [ ] Disallow barge-in during critical tools (payments, transfers)
- [ ] Dashboard visibility — show tool calls in live transcript

### Conversation Flows (State Machine)
- [ ] Flow definition in config.json — states with prompts, tools, transitions
- [ ] State tracking in brain — current state determines prompt + tools
- [ ] Per-state barge-in control
- [ ] Dashboard flow visualization

### Agent Memory
- [ ] Context auto-compaction — auto-summarize at ~80% context window
- [ ] Per-agent persistent memory — facts saved across calls
- [ ] Hybrid memory search — vector + keyword

### Safety
- [ ] Immutable safety wrapper — non-configurable system prompt layer
- [ ] Output guardrails — check response doesn't leak system prompt
- [ ] Input pattern detection — flag injection patterns

### Sentiment Analysis
- [ ] Pitch/pace analysis in Rust RTP — detect frustration/confusion
- [ ] Dynamic TTS adjustment — slower pace for frustrated callers
- [ ] Auto-escalation to human on persistent negative sentiment

---

## AriLink Competitive Advantages

Our strengths vs commercial platforms (Vapi $0.05-0.13/min, Retell $0.07-0.12/min, Bland $0.11-0.14/min):

| Advantage | Details |
|-----------|---------|
| **Fully self-hosted** | Zero per-minute API costs. Data never leaves your infrastructure. Critical for healthcare, finance, government. |
| **Asterisk/PSTN native** | Direct SIP integration, not through Twilio/Telnyx. Lower latency, more control. |
| **Local TTS (Kokoro)** | Eliminates ~50% of commercial platform costs. Saves 100-200ms network round-trip. |
| **Local STT (Parakeet)** | Same cost + latency savings for transcription. |
| **Pluggable brains** | Swap AI backends (LLM Chat, OpenClaw, custom) without changing infrastructure. |
| **OpenClaw bridge** | Full integration with OpenClaw's agent ecosystem (skills, memory, tools). |
| **AEC3 + Silero VAD** | Hardware-grade echo cancellation + neural speech detection. Better than browser-level audio. |
| **Cascading architecture** | STT→LLM→TTS is correct for telephony. Speech-to-speech degrades on 8kHz PSTN and costs ~$0.30/min. |

### Cost comparison (10,000 calls/month, 3 min avg):
| Platform | Monthly cost |
|----------|-------------|
| Vapi | $1,500 - $3,900 |
| Retell | $2,100 - $3,600 |
| Bland | $3,300 - $4,200 |
| **AriLink** | **~$50 (LLM API only)** or **$0 with local Ollama** |

---

## Completed

- [x] AEC3 echo cancellation + Silero VAD + RMS gate
- [x] Two-stage barge-in (VAD → text validation via TEC)
- [x] Post-barge-in echo suppression (1.5s TEC window) + extended debounce (500ms)
- [x] Interrupted context in LLM history (`[interrupted by user]`)
- [x] LLM-driven backchannel handling (no hardcoded word lists)
- [x] Filler sound filtering in BrainHarness (mm, uh, ah — shared across all brains)
- [x] Turn-end debouncing in BrainHarness (shared across all brains)
- [x] Per-agent `turnDebounceMs` + `maxTokens` config
- [x] ContactMatcher, InactivityTimer, RetryManager
- [x] Pluggable brain architecture (BrainHarness + IBrain)
- [x] Shared voice intelligence in BrainHarness (benefits all brains automatically)
- [x] Kokoro TTS + Parakeet STT
- [x] OpenClaw integration (channel plugin + assistant + brain)
- [x] Docker Compose + CLI tool (`arilink init/start/stop/status/logs`)
- [x] Nuxt 4 dashboard with live calls, campaigns, call history
- [x] Assistant CRUD + config editing + code editing
- [x] Extension + Caller ID routing (API + dashboard UI)
- [x] Campaign engine with maxConcurrent pacing
- [x] 3CX SIP trunk integration docs

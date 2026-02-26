# OpenClaw Integration Guide

Connect AriLink to [OpenClaw](https://openclaw.ai) to let AI agents handle real phone calls. Callers speak into their phone, AriLink transcribes and forwards to OpenClaw, OpenClaw's AI responds, and the caller hears the response via text-to-speech.

---

## Architecture Overview

```
Caller (phone)
  │
  ▼
Asterisk PBX (SIP/RTP)
  │
  ▼
AriLink Engine
  ├── STT: Parakeet (speech → text)
  ├── TTS: Kokoro (text → speech)
  └── Brain: OpenClawBrain (forwards to OpenClaw)
        │
        ▼
  OpenClaw (AI agent)
    ├── Receives transcriptions via Socket.IO
    ├── Processes with LLM (any model)
    └── Sends response text back via Socket.IO
        │
        ▼
  AriLink plays TTS audio to caller
```

**Two systems, one pipeline:**
- **AriLink** = telephony middleware (handles calls, audio, STT, TTS)
- **OpenClaw** = AI brain (handles conversation logic, tool use, memory)

---

## Prerequisites

- Docker + Docker Compose (or Docker Desktop on Windows/Mac)
- NVIDIA GPU recommended (for fast STT + TTS), CPU works but slower
- OpenClaw instance running (local or remote)
- A SIP phone or softphone for testing

---

## Step 1: Start AriLink Stack

### Option A: Docker (recommended)

```bash
# Clone the repo
git clone https://github.com/AriLink/arilink.git
cd arilink

# Create .env from example
cp .env.example .env

# Edit .env with your settings (see below)

# Start all services (Asterisk + Parakeet + Kokoro + Dashboard)
docker compose up -d
```

With NVIDIA GPU:
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

### Option B: Local dev (no Docker for AriLink)

```bash
# Start only Asterisk + Parakeet + Kokoro in Docker
docker compose up -d asterisk parakeet kokoro

# Install AriLink dependencies
cd dashboard && npm install

# Run AriLink with hot reload
PBX_IP=localhost \
TRANSCRIPTION_SERVICES=ws://localhost:5000 \
TTS_SERVICE=ws://localhost:5001 \
npm run dev
```

### Verify services are running

Open the dashboard at `http://localhost:3011`. You should see service status indicators:

| Service | Expected Status |
|---------|----------------|
| Asterisk | Connected |
| Transcription | Connected |
| TTS | Connected |

If TTS shows "Disabled", set `TTS_SERVICE=ws://localhost:5001` in your `.env`.

---

## Step 2: Configure the OpenClaw Assistant

### Option A: Use the brain system (recommended)

Edit `assistants/openclaw/config.json`:

```json
{
  "name": "OpenClawAssistant",
  "brain": "openclaw",
  "mode": "incoming",
  "language": "en-US",
  "prompts": {
    "welcome": "custom/openclaw_welcome",
    "goodbye": "custom/goodbye",
    "error": "custom/error",
    "timeout": "custom/timeout"
  },
  "behavior": {
    "maxRetries": 3,
    "timeoutSeconds": 60,
    "silenceThresholdSeconds": 10
  }
}
```

The `"brain": "openclaw"` field tells the AssistantFactory to load the OpenClawBrain and wrap it in a BrainHarness. You can change the brain to any other available brain without modifying code.

### Option B: Use the direct assistant class

If `config.json` does NOT have a `"brain"` field, the factory loads `OpenClawAssistant.ts` directly. This is the classic approach — works the same way but the logic is embedded in the assistant class rather than a swappable brain.

### Available brains

| Brain | Slug | Description |
|-------|------|-------------|
| IVR Transfer | `ivr-transfer` | DTMF gate → voice → contact match → transfer |
| Direct Dial | `direct-dial` | Voice → contact match → transfer (no DTMF) |
| OpenClaw | `openclaw` | Forward transcriptions to OpenClaw AI |
| Auto Dialer | `auto-dialer` | Outbound campaign call logic |

---

## Step 3: Route Calls to OpenClaw

Edit `config/routing.json` to send calls on specific extensions to the OpenClaw assistant:

```json
{
  "defaultAssistant": "ivr-transfer",
  "extensionRoutes": [
    { "pattern": "10[0-9]", "assistant": "direct-dial" },
    { "pattern": "20[0-9]", "assistant": "ivr-transfer" },
    { "pattern": "30[0-9]", "assistant": "openclaw" }
  ],
  "callerIdRoutes": []
}
```

With this config:
- Extensions 100-109 → Direct Dial assistant
- Extensions 200-209 → IVR Transfer assistant
- **Extensions 300-309 → OpenClaw AI assistant**
- Everything else → default (ivr-transfer)

Or make OpenClaw the default for all calls:

```json
{
  "defaultAssistant": "openclaw"
}
```

---

## Step 4: Install the OpenClaw Channel Plugin

On the OpenClaw side, install the AriLink channel plugin so OpenClaw knows how to talk to AriLink.

```bash
# In your OpenClaw installation
openclaw plugins install @openclaw/arilink
```

Or for local development (from the AriLink repo):

```bash
# Install plugin dependencies first
cd packages/arilink && npm install

# Link the plugin to OpenClaw
openclaw plugins install --link ./packages/arilink
```

### Configure the plugin

In OpenClaw's channel settings, configure the AriLink channel:

| Setting | Value | Description |
|---------|-------|-------------|
| `arilinkUrl` | `http://localhost:3011` | AriLink dashboard URL |
| `autoAnswer` | `true` | Auto-route incoming calls to AI |
| `greeting` | `"Hello, how can I help?"` | Greeting text (spoken via TTS) |
| `ttsProvider` | `"asterisk"` | Use AriLink's Kokoro TTS |
| `silenceTimeoutMs` | `30000` | Hang up after 30s silence |
| `maxCallDurationMs` | `600000` | Max 10 minutes per call |

The plugin connects to AriLink's Socket.IO server and registers itself as an OpenClaw client.

---

## Step 5: Test the Integration

### 1. Register a SIP phone

Use any softphone (Zoiper, Linphone, or AriLink's built-in WebRTC softphone):

- **Server**: `localhost:5060` (or your PBX IP)
- **Extension**: `1001`
- **Password**: `demo1001` (Docker default)

### 2. Make a test call

Dial the extension you routed to OpenClaw (e.g., `300`).

### 3. Expected flow

```
1. Phone rings → Asterisk answers → AriLink receives StasisStart
2. AriLink creates OpenClawAssistant (or BrainHarness with OpenClawBrain)
3. Welcome audio plays (if configured)
4. Assistant enters LISTENING state
5. You speak → Parakeet transcribes → text sent to OpenClaw
6. OpenClaw AI processes → sends response text back
7. AriLink synthesizes response via Kokoro TTS → plays to your phone
8. Back to LISTENING (loop until hangup)
```

### 4. Monitor in dashboard

The dashboard at `http://localhost:3011` shows:
- Active calls with real-time status
- Transcription text as it comes in
- Service health (Asterisk, STT, TTS)
- Log stream for debugging

---

## Environment Variables Reference

Add these to your `.env` file:

```bash
# === Required for OpenClaw ===

# Asterisk ARI credentials
ASTERISK_LOGIN=arilink
ASTERISK_PASSWORD=arilink123

# Speech-to-Text (Parakeet)
TRANSCRIPTION_SERVICES=ws://localhost:5000

# Text-to-Speech (Kokoro) — REQUIRED for OpenClaw
TTS_SERVICE=ws://localhost:5001

# === Optional TTS tuning ===

# Kokoro voice (see https://huggingface.co/hexgrad/Kokoro-82M)
TTS_VOICE=af_heart

# Speech speed (1.0 = normal, 0.8 = slower, 1.2 = faster)
TTS_SPEED=1.0

# Language: a=American English, b=British, e=Spanish, f=French, j=Japanese
TTS_LANG=a

# === Optional: routing ===

# Default assistant for unmatched extensions
DEFAULT_ASSISTANT=openclaw

# Or use routing.json for per-extension routing (see Step 3)
```

### Docker-specific env vars

When running fully in Docker, the service hostnames change:

```bash
# docker-compose.yml sets these automatically:
PBX_IP=asterisk                        # not localhost
TRANSCRIPTION_SERVICES=ws://parakeet:5000
TTS_SERVICE=ws://kokoro:5001
```

---

## Socket.IO Event Flow

For developers who want to understand or extend the integration.

### AriLink → OpenClaw (via DashboardServer)

| Event | Payload | When |
|-------|---------|------|
| `openclaw:transcription` | `{ sessionId, callId, text, isFinal, callerNumber }` | Caller speaks |
| `openclaw:call-started` | `{ sessionId, callerId, extension }` | Call begins |
| `openclaw:call-ended` | `{ callId, reason }` | Call ends |

### OpenClaw → AriLink (via Socket.IO)

| Event | Payload | When |
|-------|---------|------|
| `openclaw:register` | — | Plugin connects |
| `openclaw:speak` | `{ sessionId, text }` | AI wants to speak |
| `openclaw:hangup` | `{ sessionId }` | AI wants to end call |
| `openclaw:transfer` | `{ sessionId, destination }` | AI wants to transfer |
| `openclaw:initiate_call` | `{ number, assistantType? }` | AI initiates outbound call |

### Dashboard action routing

OpenClaw events arrive at `DashboardServer`, which calls `actionHandler(action, data)` on the `AriControllerServer`. The controller finds the active session and performs the telephony action.

---

## Troubleshooting

### "TTS: Disabled" in dashboard

TTS_SERVICE is not set. Add to `.env`:
```bash
TTS_SERVICE=ws://localhost:5001
```
Then restart AriLink.

### Kokoro takes long to start

First start downloads the model (~500MB). Check logs:
```bash
docker compose logs -f kokoro
```
The healthcheck has a 180-second start period. Wait for "Server started on port 5001".

### No audio plays to caller

1. Check TTS is connected (dashboard status)
2. Check Asterisk can access temp files: TTS writes to `/tmp/arilink_tts/`
3. Check logs for `[TTS]` or `[speakOnChannel]` entries

### OpenClaw not receiving transcriptions

1. Verify the OpenClaw channel plugin is installed and connected
2. Check dashboard — OpenClaw clients should appear when the plugin connects
3. Look for `[DashboardServer] openclaw:register` in logs
4. Make sure `arilinkUrl` in the plugin config matches your AriLink URL

### Caller hears nothing after speaking

1. Check Parakeet is running: `docker compose logs parakeet`
2. Check transcription appears in dashboard logs
3. Check OpenClaw is responding (check OpenClaw logs)
4. Check Kokoro is synthesizing: look for `[TTS] Synthesized` in AriLink logs

### Call connects but immediately drops

Check that the assistant type matches the extension routing. If `routing.json` points to an assistant that doesn't exist, the factory throws an error and the call drops. Check logs for `[AssistantFactory] Unknown assistant type`.

---

## Custom Welcome Audio

Record a welcome message and upload it to Asterisk:

```bash
# Convert to sln16 format (best quality for Asterisk)
sox welcome.wav -r 16000 -t raw -e signed -b 16 openclaw_welcome.sln16

# Upload to Asterisk custom sounds
# Docker:
docker cp openclaw_welcome.sln16 arilink-asterisk:/var/lib/asterisk/sounds/custom/

# Or via the AriLink dashboard's asset manager (if SSH is configured)
```

Reference in `config.json`:
```json
{
  "prompts": {
    "welcome": "custom/openclaw_welcome"
  }
}
```

If no welcome audio file exists, the OpenClawBrain skips the welcome and goes straight to listening. OpenClaw can send its own greeting via TTS.

---

## Advanced: Creating a Custom Brain

If you want custom call logic beyond what OpenClaw provides, create a new brain:

### 1. Create the brain file

`assistants/brains/MyCustomBrain.ts`:

```typescript
const { AssistantState } = require("../base/AssistantTypes");
import type { IBrain, IBrainHarness } from "../base/BrainTypes";

class MyCustomBrain implements IBrain {
  private harness!: IBrainHarness;

  init(harness: IBrainHarness): void {
    this.harness = harness;
  }

  async onCallStart(callerId: string, extension: string): Promise<void> {
    this.harness.setState(AssistantState.SPEAKING);
    await this.harness.playAudio(this.harness.config.prompts.welcome);
    this.harness.setState(AssistantState.LISTENING);
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    if (!isFinal) return;

    // Your custom logic here
    this.harness.setState(AssistantState.PROCESSING);

    // Speak a response via TTS
    await this.harness.speak("I heard you say: " + text);
  }

  async onDTMFInput(digit: string): Promise<void> {
    if (digit === "0") {
      await this.harness.transferCall("100");
    }
  }

  async onCallEnd(): Promise<void> {
    console.log("Call ended");
  }

  destroy(): void {}
}

module.exports.MyCustomBrain = MyCustomBrain;
```

### 2. Use it in any assistant's config.json

```json
{
  "name": "My Custom Assistant",
  "brain": "my-custom",
  "prompts": { ... },
  "behavior": { ... }
}
```

The factory auto-discovers brains from `assistants/brains/`. The slug is derived from the filename: `MyCustomBrain.ts` → `"my-custom"`.

### 3. Brain API (IBrainHarness)

Methods available to your brain via `this.harness`:

| Method | Description |
|--------|-------------|
| `playAudio(file)` | Play pre-recorded audio (blocks until done) |
| `playAudioNoWait(file)` | Play audio without blocking |
| `playAudioWithFallback(file, fallback)` | Play audio, use fallback if file missing |
| `speak(text)` | Synthesize text via TTS and play to caller |
| `transferCall(endpoint)` | Transfer the call |
| `hangup()` | Hang up the call |
| `setState(state)` | Set assistant state (IDLE, LISTENING, PROCESSING, SPEAKING, TRANSFERRING) |
| `isState(state)` | Check current state |
| `emitEvent(event, data)` | Emit custom event (picked up by AriControllerServer) |
| `sessionId` | Current session ID |
| `config` | Assistant configuration object |

---

## What's Not Done Yet

- **Outbound dialing from OpenClaw**: The `openclaw:initiate_call` handler is stubbed — it logs but doesn't originate calls yet
- **Per-call voice selection**: TTS voice is global (`TTS_VOICE`), not per-assistant
- **ElevenLabs / cloud TTS**: Only local Kokoro TTS is implemented; cloud providers are planned
- **End-to-end testing**: The pipeline hasn't been tested with a real OpenClaw + Kokoro instance running together

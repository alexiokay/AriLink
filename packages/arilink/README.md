# @arilink/openclaw-channel

Phone calls for OpenClaw via Asterisk PBX. Self-hosted alternative to Twilio — no per-minute charges.

## What it does

- Incoming calls → local AI transcription (Parakeet) → OpenClaw AI agent → TTS response
- OpenClaw agent can initiate calls, speak, transfer, and hang up via tools
- Works with any Asterisk PBX (FreePBX, vanilla Asterisk, Docker)
- 25 languages supported via Parakeet TDT transcription

## Install

```bash
# In your OpenClaw directory
openclaw plugins install @arilink/openclaw-channel
```

## Configure

Add to your `openclaw.json`:

```json
{
  "channels": {
    "arilink": {
      "arilinkUrl": "http://localhost:3011",
      "autoAnswer": true,
      "greeting": "Hello, how can I help you today?",
      "accounts": {
        "default": { "enabled": true }
      }
    }
  }
}
```

## Requirements

You need a running AriLink instance. The easiest way:

```bash
# One command to start Asterisk + AI transcription + dashboard
docker compose up -d
```

Or use the CLI:

```bash
npm install -g arilink
mkdir my-pbx && cd my-pbx
arilink init
arilink start
```

See [AriLink](https://github.com/AriLink/arilink) for full setup.

## Agent Tools

Once installed, your OpenClaw agent can:

- **Make calls**: "Call +14155551234 and tell them about the appointment"
- **Speak during calls**: "Tell the caller their order is ready"
- **Transfer calls**: "Transfer this call to extension 2001"
- **Hang up**: "End the current call"
- **Check status**: "How many active calls are there?"

## How it works

```
Phone call → Asterisk PBX → AriLink (ARI + RTP)
                                    ↓
                              Parakeet STT (local AI)
                                    ↓
                              "I need help with..."
                                    ↓
                         OpenClaw Channel Plugin
                                    ↓
                            OpenClaw AI Agent
                                    ↓
                         "Here's what I can do..."
                                    ↓
                         OpenClaw Channel Plugin
                                    ↓
                              AriLink TTS
                                    ↓
                        Caller hears the response
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `arilinkUrl` | `http://localhost:3011` | AriLink server URL |
| `autoAnswer` | `true` | Auto-answer incoming calls |
| `greeting` | `"Hello, how can I help you today?"` | Opening TTS message |
| `ttsProvider` | `"asterisk"` | TTS engine: `asterisk`, `elevenlabs`, `openai` |
| `ttsVoice` | `""` | Voice ID (provider-specific) |
| `silenceTimeoutMs` | `30000` | Hang up after silence (0 = never) |
| `maxCallDurationMs` | `600000` | Max call duration (0 = unlimited) |

## License

ACL v1.0 — See [LICENSE](../../LICENSE)

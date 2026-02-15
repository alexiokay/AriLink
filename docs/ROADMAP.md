# ARILink — Product Roadmap

> A modular AI decision engine for telephony systems. Not a PBX plugin — **AI voice infrastructure**.

---

## Vision

```
┌─────────────────────────────────────────────────────────┐
│                  Custom Business Data                    │
│              APIs  ·  Knowledge Base  ·  CRM             │
├─────────────────────────────────────────────────────────┤
│  Analytics & Insights     │  Call Summaries · Sentiment  │
│                           │  Metrics · Compliance        │
├─────────────────────────────────────────────────────────┤
│  MCP Tool Layer           │  CRM · Calendar · SMS        │
│                           │  Database · API Calls        │
├─────────────────────────────────────────────────────────┤
│  LLM Layer                │  Decision & Reasoning        │
│                           │  Structured JSON output      │
├─────────────────────────────────────────────────────────┤
│  Conversation Engine      │  Context · Intent · Memory   │
│                           │  Real-Time AI Logic          │
├─────────────────────────────────────────────────────────┤
│  Speech Processing        │  STT: Parakeet / Riva        │
│                           │  TTS: Piper / ElevenLabs     │
├─────────────────────────────────────────────────────────┤
│  Telephony Layer          │  Asterisk / FreePBX (ARI)    │
│                           │  → later: Twilio, WebRTC     │
└─────────────────────────────────────────────────────────┘
```

The system sits between **voice**, **AI models**, **business data**, and **automation tools**.

---

## Core Architecture Principles

### Layer Isolation

Each layer is independent. Never let:
- STT know about LLM
- LLM know about telephony
- Tools know about audio

This means you can swap Parakeet → Riva, swap Mistral → local LLM, add GPU acceleration — without rewriting core logic.

### Two Parallel Loops (Real-Time Calls)

```
Loop A: Speech Loop (latency-critical)          Loop B: Decision Loop
─────────────────────────────                    ─────────────────────
audio in → STT → partial transcript       →     detect pause / intent completion
                                                        ↓
                                                 send to LLM (with full context)
                                                        ↓
                                                 structured decision (JSON)
                                                        ↓
                                                 validate → execute tool
                                                        ↓
                                          ←      TTS → stream audio back
```

Allow interruption: if caller speaks during TTS → cancel playback → resume listening.

### Layered Decision Engine

Don't let LLM control everything. Use 3 tiers:

```
Transcript chunk
       ↓
  1. Intent Classifier (fast, lightweight)
     "book appointment" / "complaint" / "transfer" / "pricing"
       ↓
  2. Rule Engine (business-defined, zero latency)
     If emergency keyword → transfer immediately
     If after hours → switch to voicemail mode
     If simple FAQ → cached answer (skip LLM entirely)
       ↓
  3. LLM Reasoning (complex cases only)
     Multi-turn context, tool calls, nuanced decisions
       ↓
  Structured JSON output → MCP validates → execute
```

This reduces cost & latency. Simple questions never hit the LLM.

### Business Data Injection (3 Levels)

**Level 1 — Static Business Profile (no coding)**

Business fills in dashboard forms:
```
BusinessProfile {
  name, description, tone_style
  faq[]           // "What are your hours?" → "Mon-Fri 9-5"
  pricing[]       // service → price
  hours           // opening hours
  policies[]      // return policy, cancellation terms
}
```
Injected into LLM system prompt: *"You are the receptionist for {name}..."*

**Level 2 — Dynamic Data via MCP Tools (API integration)**

Business connects:
- CRM (contacts, deals, history)
- Calendar (availability, bookings)
- Order system (status, tracking)
- Customer DB (lookup by phone/email)

Exposed as MCP tools the LLM can call. Business provides API keys / webhooks via dashboard.

**Level 3 — Knowledge Base / RAG (document upload)**

Business uploads: PDFs, SOPs, manuals, policy docs, service catalogs.

System:
- Chunks documents
- Embeds into vector store
- During call: retrieves relevant chunks → injects into LLM context

Now the bot knows company-specific procedures. Critical for: law firms, medical clinics, technical support.

### Per-Call Personalization

When call starts:
1. Identify caller via phone number → CRM lookup
2. Inject: customer history, previous issues, last appointment, unpaid invoices
3. LLM talks contextually: *"Welcome back, I see your last appointment was..."*

### Analytics: Real-Time vs Post-Call

**Real-time path** (during call): conversation, routing, tool calls, escalation — latency-critical.

**Post-call pipeline** (async, after hangup):
```
Full transcript
       ↓
  LLM summary + structured extraction
       ↓
  {
    call_id, caller_id, summary,
    primary_intent: "appointment_booking",
    secondary_intents: ["pricing_question"],
    sentiment_score: 0.72,
    anger_detected: false,
    lead_quality_score: 0.85,
    actions_taken: ["appointment_created"],
    escalated: false,
    compliance_flags: []
  }
       ↓
  Store in analytics DB → dashboard charts, KPI tracking, lead funnel
```

### How Businesses Connect (3 Options)

| Mode | Target | Setup |
|------|--------|-------|
| **Simple** | SMB, non-technical | Dashboard forms: FAQ editor, business info, hours, pricing |
| **API** | Technical teams | Add CRM webhooks, API keys, calendar credentials in config |
| **Plugin** | Developers | Write custom assistant scripts, define MCP tool schemas, custom logic |

---

## What Already Exists (v1)

- Asterisk ARI integration with session management
- Rust RTP server for low-latency audio capture
- Parakeet STT (25 languages, auto-detection, auto-spawn from Engine)
- Pluggable assistant architecture (state machine based)
- Campaign engine (auto-dialer with concurrent calls)
- Nuxt 4 dashboard with real-time Socket.IO
- AI-powered assistant code editor (Mistral)
- Call history with SQLite storage
- Contact matching
- Routing rules engine

---

## Phase 1: Post-Call Intelligence

> Lowest effort, instant demo value.

After every call, feed transcript to LLM → structured analysis.

### Features

- `onCallEnd()` hook in BaseAssistant — collects full transcript, sends to LLM
- LLM returns: **summary**, **sentiment** (positive/neutral/negative), **action items**, **language**
- Store in CallHistory alongside raw transcript
- Dashboard: color-coded sentiment badges, expandable AI summary per call
- Email report via SMTP (nodemailer) to configured address

### Environment Variables

| Variable | Description |
|----------|-------------|
| `POST_CALL_LLM` | Enable post-call analysis (`true`/`false`) |
| `SUMMARY_EMAIL` | Recipient for call reports |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | SMTP config |

### Demo: "AI Analyzes Every Phone Call in Real-Time"

1. Make a call, have a conversation
2. Hang up
3. Dashboard shows instant AI summary + sentiment badge
4. Email arrives with formatted report

---

## Phase 2: MCP Tool Layer + Integrations

> The biggest differentiator. LLM requests tools, MCP validates and executes.

The LLM never executes actions directly. It outputs structured JSON tool calls. The MCP layer validates permissions and executes.

### Core MCP Tools

**Telephony:**
| Tool | Description |
|------|-------------|
| `transfer_call` | Transfer to extension, queue, or external number |
| `hangup_call` | End the current call |
| `park_call` | Park call for pickup |
| `whisper_agent` | Whisper to human agent during call |
| `queue_add` | Add caller to queue |

**Messaging:**
| Tool | Description |
|------|-------------|
| `send_sms` | Send SMS via Asterisk MessageSend / GSM gateway / carrier API |
| `send_email` | Send email via SMTP |
| `send_whatsapp` | Send WhatsApp message via WhatsApp Business API |

**CRM:**
| Tool | Description |
|------|-------------|
| `create_contact` | Create new CRM contact |
| `update_contact` | Update existing contact |
| `get_contact` | Look up contact by phone/email |
| `create_deal` | Create sales deal/opportunity |
| `log_call_note` | Attach note to contact record |

**Calendar:**
| Tool | Description |
|------|-------------|
| `check_availability` | Query calendar for free slots |
| `book_appointment` | Book a time slot |
| `cancel_appointment` | Cancel existing appointment |

**Automation:**
| Tool | Description |
|------|-------------|
| `trigger_webhook` | POST JSON to any URL (Zapier, n8n, custom) |
| `create_ticket` | Create support ticket |
| `add_tag` | Tag the call/contact |
| `score_lead` | Score lead quality |

**AI:**
| Tool | Description |
|------|-------------|
| `analyze_sentiment` | Run sentiment analysis |
| `detect_intent` | Classify caller intent |
| `summarize_call` | Generate call summary |
| `generate_followup` | Draft follow-up message |

### Per-Assistant Tool Config

```json
{
  "name": "AI Receptionist",
  "mode": "incoming",
  "tools": ["transfer_call", "book_appointment", "check_availability", "send_sms"],
  "integrations": [
    { "type": "sms", "on": "appointment_booked", "to": "+48..." },
    { "type": "webhook", "on": "call_end", "url": "https://crm.example.com/api/calls" },
    { "type": "google_calendar", "calendarId": "primary" }
  ]
}
```

### SMS Options

SMS is sent self-hosted — no Twilio dependency:
- **Asterisk `MessageSend()`** — SIP MESSAGE via a trunk that supports SMS
- **chan_dongle / GoIP** — USB GSM modem or network GSM gateway on the FreePBX server, sends real SMS from a SIM
- **Carrier HTTP API** — direct integration with local carriers (e.g., SMSAPI.pl, SerwerSMS, BulkSMS)
- **Email-to-SMS** — some carriers support SMS via email gateway

### Demos

**"AI Receptionist Books Appointments"** — Caller says "book me Thursday at 3pm" → checks calendar → confirms → sends SMS

**"AI Sales Closer"** — Qualifies lead → scores it → fires webhook to CRM → offers human callback

---

## Phase 3: LLM Conversational Voice Agent

> Full AI voice agent — thinks and speaks naturally.

### Architecture

```
Caller → Asterisk → Rust RTP → Parakeet STT
                                    ↓
                              Conversation Engine
                              (context + history + business data)
                                    ↓
                              LLM (Mistral / GPT / Claude)
                              → text response
                              → tool calls (MCP)
                                    ↓
                              Piper TTS → audio
                                    ↓
                              Asterisk → Caller
```

### Key Components

**Conversation Engine** — the brain:
- Maintains conversation state per call
- Keeps message history (multi-turn)
- Injects business context (FAQs, pricing, SOPs, opening hours)
- Sends to LLM, receives structured response
- LLM outputs decisions as JSON, not free text

**TTS Service** (same auto-spawn pattern as Parakeet):

| Engine | Type | Languages | Latency | Quality | Cost |
|--------|------|-----------|---------|---------|------|
| **Piper TTS** | Local | 20+ | ~100ms | Good | Free (MIT) |
| **Coqui TTS** | Local | 15+ | ~200ms | Great | Free (MPL) |
| **ElevenLabs** | Cloud | 30+ | ~300ms | Excellent | $5-99/mo |
| **OpenAI TTS** | Cloud | 50+ | ~400ms | Excellent | Per char |

Recommended: **Piper TTS** for local/free. Auto-spawned by Engine like Parakeet.

### New Assistant Type: `ConversationalAssistant`

Extends BaseAssistant:
- System prompt defines personality, knowledge, rules
- Streaming: start TTS on first LLM sentence (low latency)
- Barge-in: detect caller speaking → stop TTS → listen
- Tool use: LLM calls MCP tools mid-conversation
- Multi-language: detect language from STT, respond in same language

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TTS_SERVICE` | TTS URL (`ws://localhost:5001`) |
| `AUTO_START_TTS` | Auto-start TTS on Engine boot |
| `CONVERSATION_LLM` | Provider (`mistral`/`openai`/`anthropic`) |
| `CONVERSATION_MODEL` | Model name |
| `CONVERSATION_API_KEY` | API key |

### Business Data Injection

Businesses provide:
- FAQs, pricing sheets, SOPs
- Services list, opening hours
- CRM access credentials

System:
- Embeds documents (RAG or direct context injection)
- Injects into LLM system prompt per call
- LLM makes decisions based on real business data

### Demos

**"I Replaced My Receptionist With AI"** — Natural conversation, books appointment, sends SMS, shows summary

**"Multi-Language Voice Agent"** — Switch English → Polish → German mid-call, AI follows

**"Voice-Controlled PBX"** — "Disable extension 200" → AI confirms → executes ARI command

---

## Phase 4: Analytics & Compliance (Enterprise)

> Where enterprise/SaaS revenue lives.

### Analytics

- Trend charts: sentiment over time, call volume, resolution rate
- Per-agent KPIs: average call duration, satisfaction score, conversion rate
- Lead scoring across campaigns
- Dashboard widgets with drill-down

### Compliance Monitor

- Run transcripts through compliance rules (LLM or keyword-based)
- Detect: forbidden phrases, missing disclosures, GDPR violations
- Per-agent compliance scoring
- Flagged calls with violation timestamp + details
- Export: CSV, PDF reports

```json
{
  "rules": [
    { "type": "required_phrase", "phrase": "This call may be recorded", "within_seconds": 30 },
    { "type": "forbidden_phrase", "phrases": ["I guarantee", "100% certain"] },
    { "type": "gdpr_consent", "required": true },
    { "type": "sentiment_threshold", "min": -0.5, "action": "escalate" }
  ]
}
```

### Demo: "AI Compliance Monitor for Call Centers"

Dashboard with calls → some flagged red → click to see violation → export report

---

## Phase 5: Multi-Agent Orchestration

> Different AI personas for different scenarios.

### Agent Types

| Agent | Trigger | Personality |
|-------|---------|-------------|
| **Receptionist** | Incoming call to main line | Friendly, books appointments |
| **Sales** | Incoming call to sales ext | Qualifying, persuasive |
| **Support** | Incoming call to support | Patient, looks up orders |
| **After-Hours** | Call outside business hours | Takes messages, emergencies |
| **Outbound Sales** | Campaign dialer | Pitch-focused |
| **Survey** | Post-service callback | Brief, structured questions |

### Routing Logic

```
Incoming call
    ↓
Routing rules (extension, caller ID, time of day)
    ↓
Select assistant (agent type)
    ↓
Load agent personality + tools + business context
    ↓
Handle call
```

Already partially exists via assistant routing rules on the Config page.

---

## Phase 6: Platform Expansion

> Telephony becomes just one adapter.

### Beyond Asterisk

| Platform | Integration |
|----------|------------|
| **Twilio** | SIP trunk / Programmable Voice API |
| **WebRTC** | Browser-based softphone (partially exists) |
| **Teams / Zoom** | Bot integrations |
| **SIP providers** | Direct SIP trunking |

### Multi-Tenant (SaaS)

- Per-tenant config, assistants, data isolation
- Tenant onboarding wizard
- Usage metering (calls, minutes, LLM tokens)
- Billing integration (Stripe)

---

## Data Privacy & Compliance Layer

Required for any business deployment. Runs across all phases.

- **Data retention controls** — configurable auto-delete (7d, 30d, 90d, custom)
- **Transcript encryption** at rest (SQLite encryption or encrypted file storage)
- **Access roles** — admin, manager, agent (who can see transcripts, analytics, config)
- **GDPR tools** — data export per caller, right-to-delete, consent tracking
- **Audit log** — who accessed what, when

This isn't a phase — it's a cross-cutting concern that grows with each phase.

---

## Analytics Dashboard Features

Built incrementally across phases:

| Metric | Phase |
|--------|-------|
| Calls per day / hour | 1 |
| Sentiment breakdown (pie chart) | 1 |
| Intent classification | 1 |
| Lead quality scores | 2 |
| Booking conversion rate | 2 |
| AI vs human resolution rate | 3 |
| Average call duration | 1 |
| Escalation rate | 4 |
| Compliance score per agent | 4 |
| Revenue attribution | 2 + 4 |

---

## Business Model

| Tier | Features | Target |
|------|----------|--------|
| **Community (Free)** | Core AI call handling, basic analytics, local only, no login required | Developers, tinkerers |
| **Pro** | Advanced analytics, CRM integrations, multi-tenant, premium voices, cloud backup | SMB |
| **Enterprise** | SLA support, custom integrations, GPU-optimized builds, managed hosting, compliance | Call centers |

---

## Use Cases Summary

| Use Case | Phase Required | Key Tools |
|----------|---------------|-----------|
| AI Receptionist | 3 | `book_appointment`, `send_sms`, `transfer_call` |
| AI Sales Assistant | 3 | `score_lead`, `create_deal`, `trigger_webhook` |
| AI Support Bot | 3 | `get_contact`, `create_ticket`, `transfer_call` |
| Call Analytics | 1 + 4 | `summarize_call`, `analyze_sentiment` |
| Compliance Monitor | 4 | Rule engine, transcript analysis |
| Campaign Dialer | Exists | Auto-dialer + assistant scripts |
| Multi-Language Agent | 3 | Parakeet auto-detect + LLM + TTS |

---

## Implementation Priority

| Phase | Effort | Demo Value | Revenue |
|-------|--------|------------|---------|
| 1 — Post-call intelligence | Low | High | Medium |
| 2 — MCP tool layer | Medium | High | High |
| 3 — LLM + TTS voice agent | High | Massive | Very high |
| 4 — Compliance & analytics | Medium | High | Enterprise |
| 5 — Multi-agent orchestration | Medium | High | High |
| 6 — Platform expansion | High | Strategic | SaaS |

Each phase is independently useful and demo-worthy. Phase 1 can ship fast and produce compelling content immediately.

---

## One-Click Deployment & Transcription Management

> Make ARILink deployable by anyone — from zero to running in minutes.

### Deployment Strategy

The app has 3 tiers of compute needs:

| Component | Needs | Runs on... |
|-----------|-------|------------|
| **Dashboard + ARI logic** | Node.js, tiny CPU | Anything (Railway, Fly, VPS, Docker) |
| **Rust RTP server** | Small binary, low CPU | Same box or sidecar container |
| **Transcription** | GPU or cloud API | Cloud provider, RunPod, or local GPU |

### One-Click Deploy Options

**Option A: Cloud transcription only (simplest)**
- Multi-stage Dockerfile: build Rust binary → bundle with Node.js
- Deploy on Railway / Render / Fly.io with a single button
- Transcription via cloud APIs only (Deepgram, Google Cloud Speech, AssemblyAI)
- User sets env vars (API keys) — no GPU needed

**Option B: Hybrid — cheap host + GPU transcription**
- App on Railway/Render ($5/mo)
- Parakeet on RunPod serverless (pay-per-second GPU, ~$0.00026/sec)
- Connect via WebSocket URL in `TRANSCRIPTION_SERVICES` — already supported
- Template: one-click RunPod serverless endpoint with Parakeet pre-configured

**Option C: All-in-one Docker Compose on GPU VPS**
- Single `docker-compose.yml` with all 3 services
- Deploy on Lambda Labs, RunPod pods, Hetzner GPU
- True self-hosted, zero cloud dependencies

### Deliverables

- [ ] Multi-stage `Dockerfile` (Rust build + Node.js + dashboard)
- [ ] `docker-compose.yml` with all services
- [ ] `railway.json` / `render.yaml` for one-click deploy buttons
- [ ] Deploy button in README ("Deploy to Railway", "Deploy to Render")
- [ ] RunPod serverless template for Parakeet transcription endpoint
- [ ] `.env.example` with all options documented

### Transcription Management GUI

Dashboard page for managing transcription providers — local models, cloud APIs, and GPU hosting.

```
Dashboard → Settings → Transcription
├── Cloud Providers
│   ├── Google Cloud Speech  [API Key: ****] [Connected ✓]
│   ├── Deepgram             [Add key...]
│   └── AssemblyAI           [Add key...]
├── Local Models
│   ├── Parakeet TDT 0.6B   [Downloaded ✓] [Active] [Remove]
│   ├── Whisper Large v3     [Download 3.1GB...]
│   └── Whisper Medium       [Download 1.5GB...]
├── GPU Providers
│   ├── RunPod Serverless    [API Key: ****] [Configure...]
│   └── Custom endpoint      [ws://...]
└── Priority Order
    1. Parakeet TDT 0.6B (local)     [↑↓]
    2. Google Cloud Speech (fallback) [↑↓]
```

### Features

- **Model registry** — list of supported models with size, language support, speed benchmarks
- **Download manager** — download/remove local models with progress bar
- **Cloud provider setup** — API key input, connection test, usage stats
- **RunPod integration** — create/manage serverless GPU endpoints from the dashboard
- **Priority ordering** — drag-and-drop to set primary/fallback transcription chain
- **Auto-detection** — on first boot, detect available GPU/CPU and suggest optimal config
- **Health monitoring** — real-time status of each provider (latency, error rate, availability)

### How It Wires Together

The GUI writes to `TRANSCRIPTION_SERVICES` env var format that already exists:
```
TRANSCRIPTION_SERVICES=ws://localhost:5000,ws://runpod-endpoint:5000,google
```
First = primary, rest = automatic fallbacks. No code changes needed in the transcription pipeline.

### Implementation Notes

- Model downloads go to a configurable `models/` directory (gitignored)
- RunPod API: `POST /v2/{endpoint_id}/run` for serverless inference
- Health checks: ping each provider on interval, update dashboard status badges
- Auto-spawn: if local model selected and not running, Engine auto-starts it (existing pattern)

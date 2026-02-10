# Future Enhancements & Optional Features

This document tracks potential features and improvements for AriLink.

---

## 📞 Auto-Dialer Assistant

### Status
- **Priority:** HIGH
- **Implementation:** DONE ✅
- **Complexity:** Low-Medium

### Overview
Outbound auto-dialer that calls numbers from a list, plays a message, and transfers on DTMF input.

### Flow
```
Read phone list (JSON) → Originate call → Play message → Wait for DTMF "1" → Transfer to destination → Log result → Next number
```

### Implemented Features
- ✅ Phone number list from JSON file
- ✅ Configurable concurrent calls (respect SIP trunk limits)
- ✅ Pre-recorded message playback
- ✅ DTMF detection for call routing (configurable transfer digit)
- ✅ Transfer to configurable destination (via `config.json` or env vars)
- ✅ Call result logging (answered, busy, no answer, failed, transferred)
- ✅ Campaign result persistence (`campaign-results/campaign-{timestamp}.json`)
- ✅ Pause/resume/stop campaign
- ✅ CLI launch: `npm run start:autodialer` or `npm start -- --assistant auto-dialer --phone-list path/to/list.json`

### Architecture
- Campaign engine: `core/AutoDialer.ts`
- Per-call assistant: `assistants/auto-dialer-call/AutoDialerCallAssistant.ts`
- Config: `assistants/auto-dialer-call/config.json` (transfer destination, trunk, max concurrent, prompts)
- Example phone list: `tools/phone-list.example.json`
- Uses shared utilities: `InactivityTimer` for DTMF wait timeout

---

## 🐳 Docker Deployment

### Status
- **Priority:** Medium
- **Implementation:** Planned (files created then removed, will re-add)
- **Complexity:** Medium

### Overview
Docker Compose setup for one-command VPS deployment.

### Components
```
VPS (Debian 12)
├── Asterisk/FreePBX container
├── AriLink container (Node.js)
└── Optional: Parakeet container (if transcription needed)
```

### Open Question
- Which FreePBX Docker image to use (need Asterisk 18 on Debian)
- Or: bare Asterisk (mlan/asterisk) without FreePBX GUI
- Or: install FreePBX directly on VPS, only Dockerize AriLink

---

## 💾 Database Integration

### Status
- **Priority:** Medium
- **Implementation:** Not started

### Overview
Persistent storage for call records, transcriptions, campaign data.

### Options
- **SQLite** - Simple, file-based, good for <1000 calls/day
- **PostgreSQL** - Scalable, production-grade

### Schema (key tables)
- `calls` - Call metadata (from, to, duration, status, direction)
- `transcriptions` - Timestamped transcription chunks per call
- `campaigns` - Auto-dialer campaigns
- `call_list` - Phone numbers per campaign with status tracking

---

## 🖥️ Web UI Dashboard

### Status
- **Priority:** Medium
- **Implementation:** Not started
- **Dependencies:** Database integration

### Overview
Web-based dashboard for monitoring and management. Only build features FreePBX can't do.

### Pages
1. **Dashboard** - Active calls, today's stats, system status
2. **Campaign Management** - Upload CSV, start/stop auto-dialer, view results
3. **Call History** - Searchable table, export to CSV
4. **Sound File Manager** - Upload/preview/convert WAV files for IVR prompts
5. **Settings** - Transcription service config, SIP trunk settings

### Tech Stack
- Frontend: React + Tailwind + Shadcn
- Backend: Express.js + Socket.io (already in project)
- Real-time call updates via WebSocket

---

## 🔊 Call Recording

### Status
- **Priority:** Medium
- **Complexity:** Low

### Features
- Record calls via ARI `channel.record()`
- Automatic or selective recording
- Local storage or S3/cloud
- WAV/MP3 format
- Retention policy (auto-delete after X days)
- GDPR: user consent handling

---

## 🎙️ Advanced Transcription Features

### Speaker Diarization
- Distinguish caller vs agent
- Pyannote.audio or Google Cloud Speech built-in diarization

### Custom Vocabulary
- Improve recognition of industry-specific terms
- Google Cloud supports custom vocabulary
- Whisper can be fine-tuned

### Additional Providers
- ElevenLabs Scribe
- Azure Speech
- Deepgram

---

## 🔐 Security & Authentication

### Status
- **Priority:** HIGH for production
- **Current:** No authentication

### Features
- JWT-based login system
- Role-Based Access Control (Admin, Supervisor, Agent, Viewer)
- API keys for programmatic access
- Rate limiting, CORS, HTTPS

---

## 🔄 Integrations

### CRM Systems
- Salesforce, HubSpot, Zoho, custom via webhooks
- Auto-create contacts, log calls, update lead status

### Communication Platforms
- Slack/Teams notifications
- Email reports
- SMS alerts

---

## 📊 Analytics

### Status
- **Priority:** Low
- **Dependencies:** Database, Web UI

### Features
- Call volume trends (hourly/daily/weekly)
- Success rates, average duration
- Campaign conversion rates
- Best time to call optimization
- Transcription keyword tracking

---

## 🧪 Testing & Monitoring

### Automated Testing
- Unit tests (Jest)
- Integration tests for call flows
- Load tests for concurrent calls

### Monitoring
- Prometheus metrics
- Grafana dashboards
- Sentry error tracking

---

## 🎯 Priority Matrix

| Feature | Priority | Complexity | Effort | Dependencies |
|---------|----------|------------|--------|--------------|
| **Auto-Dialer Assistant** | ~~HIGH~~ | ~~Low-Medium~~ | ~~3-5 days~~ | DONE ✅ |
| **Docker Deployment** | Medium | Medium | 2-3 days | None |
| **Database Integration** | Medium | Medium | 1 week | None |
| **Web UI Dashboard** | Medium | High | 3-4 weeks | Database |
| **Sound File Manager** | Medium | Low | 3 days | Web UI |
| **Call Recording** | Medium | Low | 3 days | None |
| **Security/Auth** | High (prod) | Medium | 1 week | None |
| **Analytics** | Low | Medium | 2 weeks | Database |
| **CRM Integration** | Low | Medium | 1 week/CRM | None |
| **MCP Server Integration**| HIGH | Medium | 1 week | None |

---

## 🗓️ Roadmap

### Phase 1: Core (DONE)
- ✅ ARI call handling + multi-call support
- ✅ Real-time transcription (Parakeet, Whisper, Google Cloud)
- ✅ Automatic transcription service failover
- ✅ Assistant architecture (BaseAssistant, Factory, IVR Transfer, Direct Dial)
- ✅ 3CX integration documentation
- ✅ DTMF handling + bridge management

### Phase 2: Auto-Dialer & Architecture (DONE)
- ✅ Auto-dialer campaign engine (`core/AutoDialer.ts`)
- ✅ Auto-dialer per-call assistant (`AutoDialerCallAssistant`)
- ✅ Campaign result persistence (JSON files)
- ✅ Shared utilities extracted: `ContactMatcher`, `InactivityTimer`, `RetryManager`
- ✅ Per-assistant `config.json` (transfer destination, trunk, campaign settings)
- ✅ Config hierarchy: `config.json > .env > defaults`
- ✅ CLI args: `--assistant`, `--phone-list`
- ✅ npm convenience scripts: `start:ivr`, `start:dial`, `start:autodialer`
- ✅ Config validation in BaseAssistant constructor

### Phase 3: Production Ready (Next)
- Docker deployment for VPS
- Database integration
- Security & authentication
- Call recording
- Basic web UI (campaigns + monitoring)

### Phase 4: AI & Connectivity (MCP)
- Create AriLink MCP Server (`core/MCPServer.ts`)
- Expose ARI tools (originate, play, transfer) to AI agents
- Implement real-time transcription resources for MCP
- **Plan:** [MCP-INTEGRATION-PLAN.md](MCP-INTEGRATION-PLAN.md)

### Phase 5: Product
- Full web dashboard
- Sound file management GUI
- Analytics & reporting
- CRM integrations

---

## 🦀 Language Migration Research: Rust vs TypeScript ARI

### Summary (Researched 2026-02-10)

**Should we migrate from TypeScript `ari-client` to Rust?** Worth considering. The JS library is effectively unmaintained while Rust alternatives are actively developed.

### Current JS `ari-client` Status

- **Version:** 2.2.0 — **last published ~6 years ago (2020)**
- GitHub issue #132: "status of node-ari-client" — not officially abandoned but effectively stale
- Described as "best effort with limited support" by Asterisk/Sangoma
- Works but has deprecated dependencies and callback-style API
- No TypeScript types (community `@types/ari-client` exists separately)

### Rust ARI Libraries

| Library | Version | Updated | Stars | Coverage |
|---------|---------|---------|-------|----------|
| **asterisk-ari** (jBernavaPrah) | v0.3.0 | Mar 2025 | 4 | Full REST API + WebSocket events. Tokio async. |
| asterisk-ari-client-rs (jabber-tools) | v0.1.4 | May 2024 | 7 | Partial. Self-described "by no means ready." |

**asterisk-ari v0.3.0** (the promising one):
- Claims full ARI REST API coverage + WebSocket event streaming
- Modern stack: tokio, reqwest, tokio-tungstenite, serde
- Example shows: StasisStart handling, channel.answer(), channel.play(), async/await
- Dual-licensed Apache 2.0 / MIT
- Concern: only 679 total downloads, 4 stars — low adoption, production-readiness unproven

### Go Alternative

- **CyCoreSystems/ari** v6 — most mature non-JS option
- Production-proven, ~150 stars, `ari-proxy` for distributed scaling via NATS
- Full ARI coverage with proper Go types

### Our ARI Feature Usage

We use: WebSocket connection, Stasis lifecycle, channel answer/hangup/originate, bridge create/addChannel/destroy, audio playback + events, DTMF events, ExternalMedia channels (direct REST).

### Recommended Path

1. **Short-term**: Stay on JS `ari-client` — it works despite being old. Improve our TypeScript types, eliminate `any` usage
2. **Medium-term**: Monitor `asterisk-ari` Rust crate (jBernavaPrah). If it reaches v1.0 with proven bridge/DTMF/ExternalMedia support, consider migrating the ARI layer to Rust
3. **High-value Rust target**: RTP audio processing — replace `rtp-udp-server.js` with Rust binary (zero-copy RTP, native VAD, audio format conversion). This is where Rust's performance actually matters
4. **Alternative**: Go (`CyCoreSystems/ari`) if we need distributed scaling before Rust matures

### Migration Risk Assessment

| Approach | Risk | Reward | When |
|----------|------|--------|------|
| Improve TS types | Low | Medium | Now |
| Rust RTP service | Medium | High | When audio pipeline needs optimization |
| Rust ARI (asterisk-ari crate) | Medium-High | High | When crate reaches v1.0+ with community adoption |
| Go ARI (CyCoreSystems) | Medium | Medium | If scaling to 100+ concurrent calls |

---

*Last Updated: 2026-02-10*

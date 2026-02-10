# Future Enhancements & Optional Features

This document tracks potential features and improvements for AriLink.

---

## 📞 Auto-Dialer Assistant

### Status
- **Priority:** HIGH
- **Implementation:** Not started
- **Complexity:** Low-Medium

### Overview
Outbound auto-dialer that calls numbers from a list, plays a message, and transfers on DTMF input.

### Flow
```
Read phone list (CSV/JSON) → Originate call → Play message → Wait for DTMF "1" → Transfer to destination → Log result → Next number
```

### Features
- Upload phone number list (CSV/JSON)
- Configurable concurrent calls (respect SIP trunk limits)
- Pre-recorded message playback
- DTMF detection for call routing
- Transfer to configurable destination (FreePBX extension, ring group, queue, or external SIP endpoint)
- Call result logging (answered, busy, no answer, failed, transferred)
- Pause/resume campaign
- Retry logic for busy/no-answer

### Implementation
- New assistant: `assistants/auto-dialer/AutoDialerAssistant.ts`
- Uses existing `channel.originate()` from ARI
- Config: phone list path, audio file, transfer destination, max concurrent calls
- No transcription needed

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
| **Auto-Dialer Assistant** | HIGH | Low-Medium | 3-5 days | None |
| **Docker Deployment** | Medium | Medium | 2-3 days | None |
| **Database Integration** | Medium | Medium | 1 week | None |
| **Web UI Dashboard** | Medium | High | 3-4 weeks | Database |
| **Sound File Manager** | Medium | Low | 3 days | Web UI |
| **Call Recording** | Medium | Low | 3 days | None |
| **Security/Auth** | High (prod) | Medium | 1 week | None |
| **Analytics** | Low | Medium | 2 weeks | Database |
| **CRM Integration** | Low | Medium | 1 week/CRM | None |

---

## 🗓️ Roadmap

### Phase 1: Core (DONE)
- ✅ ARI call handling + multi-call support
- ✅ Real-time transcription (Parakeet, Whisper, Google Cloud)
- ✅ Automatic transcription service failover
- ✅ Assistant architecture (BaseAssistant, Factory, IVR Transfer, Direct Dial)
- ✅ 3CX integration documentation
- ✅ DTMF handling + bridge management

### Phase 2: Auto-Dialer (Next)
- Auto-dialer assistant
- Campaign management (phone lists, start/stop)
- Call result logging
- Docker deployment for VPS

### Phase 3: Production Ready
- Database integration
- Security & authentication
- Call recording
- Basic web UI (campaigns + monitoring)

### Phase 4: Product
- Full web dashboard
- Sound file management GUI
- Analytics & reporting
- CRM integrations

---

*Last Updated: 2026-02-10*

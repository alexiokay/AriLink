# TODO - Architecture Improvements

## Priority 1: Extract Shared Building Blocks

- [x] **ContactMatcher** → `tools/ContactMatcher.ts`
- [x] **InactivityTimer** → `tools/InactivityTimer.ts`
- [x] **RetryManager** → `tools/RetryManager.ts`
- [x] **Config validation** in BaseAssistant constructor
- [x] **Campaign result persistence** → `campaign-results/campaign-{timestamp}.json`
- [x] **Type-safe AssistantTypes** — typed behavior fields, `[key: string]: unknown`
- [x] **BaseAssistant state enum** — proper `AssistantState` enum, `playAudioWithFallback()`, `isState()`
- [x] **Assistant state broadcast** — `dashboard:assistantState` events for live call flow visibility
- [x] **DTMF visibility** — `dashboard:dtmf` events show digits pressed in dashboard
- [x] **Contact lists** — CRUD pages + API, saved lists in campaign wizard

## Priority 2: Campaign Improvements

- [ ] Retry failed/no-answer calls (configurable max retries per number)
- [ ] Time-of-day restrictions (don't call outside business hours)
- [ ] DNC (Do Not Call) suppression list support

## Priority 3: Routing & Flexibility

- [x] **Extension routing** — `config/routing.json` with regex patterns, `createFromExtension()`
- [x] **Caller ID routing** — `config/routing.json` callerIdRoutes, `createFromCallerId()`
- [ ] Routing UI in dashboard (edit routing.json from frontend)

## Priority 4: Reliability

- [x] **Transcription WebSocket auto-reconnect** (5s delay)
- [x] **ARI connection auto-reconnect** (10s delay)
- [ ] Max concurrent session limit (prevent resource exhaustion)
- [ ] Session timeout cleanup (orphaned sessions)

## Priority 5: Future / Nice-to-Have

- [ ] Unit tests for assistants with mock ARI client
- [ ] Call recording
- [ ] WebRTC softphone in dashboard
- [ ] Docker/Kubernetes setup
- [ ] Config hot-reload for active calls


---


--- 
can we implement dialing system?  like a phone icon on bottom right that opens small phone chat? and we can trigger a number etc and listen and talk? bcs ui use micro sip rn but meh. want to have msth liek this in my dashboard to test. ??


-----
Connected (working end-to-end)
Assistant CRUD — GET/PUT/DELETE /api/assistants/{slug} + creation from template
Config editing — assistants.vue Settings tab reads/writes config.json via API
Code editing — read/write assistant TypeScript source + AI chat for code suggestions
Live calls — Socket.IO streams callUpdate, transcription, campaignStatus to frontend
Campaign control — campaignStart/Pause/Resume/Stop via Socket.IO → AutoDialer
Dashboard actions — hangup and transfer forwarded from frontend to ARI
Call history — SQLite persistence, served via GET /api/history
NOT connected (gaps)
Runtime state visibility — assistant state changes (LISTENING → PROCESSING → TRANSFERRING) aren't broadcast to frontend. Dashboard sees call outcomes but not the decision-making flow
DTMF visibility — no way to see what digits were pressed from the dashboard
Config hot-reload — saving config via API doesn't affect currently-running calls (only new calls pick up changes)
Assistant routing config — which assistant handles which extension/caller ID is hardcoded (DEFAULT_ASSISTANT env var), no UI to configure routing rules
Test/simulation mode — no way to dry-run an assistant without a real call
Bottom line
The configuration and monitoring layer is solid. The main gap is runtime introspection — the frontend can't see what state an assistant is in during a live call or why it made a specific decision. Want me to tackle any of these gaps?


----

wizard for freepbx installation on start and auto configuring easy each stuff to make it work fast etc.
 =======
FreePBX has fwconsole which is the safe way to configure things programmatically:

fwconsole setting — get/set FreePBX settings
fwconsole reload — safe reload (validates before applying, unlike raw asterisk -rx)
fwconsole ma install/enable — manage modules
FreePBX REST API (if the API module is enabled)
So a wizard could SSH in and run:

Check if ARI is enabled: grep "enabled" /etc/asterisk/ari.conf
Enable HTTP server: fwconsole setting HTTPBINDPORT etc.
Create ARI user: write to ari_additional.conf (the FreePBX-safe custom file)
fwconsole reload — safely apply
That's way safer than raw config file editing. But it's still a big scope — you'd need SSH credentials, per-distro detection (FreePBX vs vanilla vs Issabel), error recovery, etc.

My suggestion: bookmark this as a future feature. For now the connection checker gives 80% of the value at 10% of the effort — tells users exactly what's wrong and what to fix. The wizard can come later when you have more users asking for it. Want me to build the connection checker first, or do you want to jump straight into the wizard?


----
add caller id to the past canpaigns list  so we can see what campaigns use which caller id.@terminal:esbuild ,

----
auto test with AI help of checking confirming if for example dashboard conectio ndebugigns is valid or docs updated and should he also updated some changed? 

some stuff testing code etc.

---
wizard/checkcs/assistant better

----
integrate openclaw to sms bot
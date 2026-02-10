# TODO - Architecture Improvements

## Priority 1: Extract Shared Building Blocks

- [x] **ContactMatcher** → `tools/ContactMatcher.ts`
  - Extracted duplicated `findNumberByWords()` from IvrTransferAssistant and DirectDialAssistant

- [x] **InactivityTimer** → `tools/InactivityTimer.ts`
  - Reusable timeout with start/reset/cancel

- [x] **RetryManager** → `tools/RetryManager.ts`
  - Shared retry logic with configurable max, feedback intervals, and callbacks

- [x] **Config validation** in BaseAssistant constructor
  - Validates config.json schema on assistant load (name, prompts, behavior)

- [x] **Campaign result persistence** → `campaign-results/campaign-{timestamp}.json`
  - Auto-saves results with summary on campaign complete/stop

## Priority 2: Campaign Improvements

- [ ] Retry failed/no-answer calls (configurable max retries per number)
- [ ] Time-of-day restrictions (don't call outside business hours)
- [ ] DNC (Do Not Call) suppression list support

## Priority 3: Routing & Flexibility

- [ ] Implement `createFromExtension()` in AssistantFactory (currently a stub)
- [ ] Implement `createFromCallerId()` in AssistantFactory (currently a stub)
- [ ] Routing config file (`config/routing.json`) for extension/callerID/time-based routing

## Priority 4: Reliability

- [ ] Transcription WebSocket reconnection on failure
- [ ] ARI connection reconnection
- [ ] Max concurrent session limit (prevent resource exhaustion)
- [ ] Session timeout cleanup (orphaned sessions)

## Priority 5: Future / Nice-to-Have

- [ ] Database layer for session history and call analytics
- [ ] Campaign management API (start/stop/status via HTTP)
- [ ] Real-time dashboard (active calls, campaign progress)
- [ ] Unit tests for assistants with mock ARI client
- [ ] AudioSequence utility (chain multiple audio files)
- [ ] TranscriptionBuffer utility (collect partial/final cleanly)
- [ ] Call recording
- [ ] Easy converting/uploading/previewing audio to Asterisk server
- [ ] Premade Docker/Kubernetes setup
- [ ] Web app for management

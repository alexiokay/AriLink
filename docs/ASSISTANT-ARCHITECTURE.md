# 🤖 Assistant Architecture

Comprehensive guide to the modular assistant system for AriLink.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture Diagrams](#architecture-diagrams)
- [Components](#components)
- [Implementation Guide](#implementation-guide)
- [Creating Custom Assistants](#creating-custom-assistants)
- [Configuration](#configuration)
- [Examples](#examples)

---

## Overview

The assistant architecture separates **core infrastructure** (ARI communication, transcription) from **business logic** (how to respond to user input). This allows:

- ✅ **Multiple assistant types** - Customer service, sales, technical support, etc.
- ✅ **Easy customization** - Each assistant has its own behavior and prompts
- ✅ **Reusable code** - Common functionality in base classes
- ✅ **Flexible routing** - Different extensions → different assistants
- ✅ **Testable** - Mock interfaces for unit testing

---

## Architecture Diagrams

### 1. High-Level System Architecture

```mermaid
graph TB
    subgraph "FreePBX / Asterisk"
        PBX[FreePBX Server]
        ARI[ARI Interface]
    end

    subgraph "AriLink"
        subgraph "Core Infrastructure"
            Controller[AriControllerServer]
            TTS[TtsClient → Kokoro]
            RustRTP[Rust RTP Server]
        end

        subgraph "Assistant System"
            Factory[AssistantFactory]
            Base[BaseAssistant]
            Harness[BrainHarness]

            subgraph "Classic Assistants"
                IVR[IvrTransferAssistant]
                DD[DirectDialAssistant]
                OC[OpenClawAssistant]
                AD[AutoDialerCallAssistant]
            end

            subgraph "Pluggable Brains"
                LLMBrain[LlmChatBrain]
                FlowBrainNode[FlowBrain]
                IVRBrain[IvrTransferBrain]
                DDBrain[DirectDialBrain]
                OCBrain[OpenClawBrain]
            end
        end

        subgraph "Transcription Services"
            Parakeet[Parakeet TDT 0.6B-v3]
        end
    end

    PBX --> ARI
    ARI <--> Controller
    Controller --> Factory
    Factory --> IVR
    Factory --> DD
    Factory --> OC
    Factory --> AD
    Factory --> Harness

    IVR -.inherits.-> Base
    DD -.inherits.-> Base
    OC -.inherits.-> Base
    AD -.inherits.-> Base
    Harness -.inherits.-> Base

    Harness --> LLMBrain
    Harness --> FlowBrainNode
    Harness --> IVRBrain
    Harness --> DDBrain
    Harness --> OCBrain

    Controller <--> TTS
    Controller <--> RustRTP
    RustRTP <--> Parakeet

    style Controller fill:#e1f5ff
    style Factory fill:#fff4e1
    style Base fill:#f0f0f0
    style Harness fill:#fff0f5
    style IVR fill:#d4edda
    style DD fill:#d4edda
    style OC fill:#d4edda
    style AD fill:#d4edda
    style LLMBrain fill:#e7d4ed
    style IVRBrain fill:#e7d4ed
    style DDBrain fill:#e7d4ed
    style FlowBrainNode fill:#e7d4ed
    style OCBrain fill:#e7d4ed
```

### 2. Assistant Class Hierarchy

```mermaid
classDiagram
    class IAssistant {
        <<interface>>
        +onCallStart(channel, callerId, extension)
        +onCallEnd(channel)
        +onTranscription(text, isFinal)
        +onDTMFInput(digit)
        +playAudio(audioFile)
        +speak(text)
        +transferCall(extension)
        +getState()
        +setState(state)
    }

    class BaseAssistant {
        <<abstract>>
        #config: AssistantConfig
        #state: AssistantState
        #channel: Channel
        +playAudio(audioFile)
        +speak(text)
        +transferCall(extension)
        +getState()
        +setState(state)
    }

    class BrainHarness {
        -brain: IBrain
        +onCallStart()
        +onTranscription()
        +onDTMFInput()
        +onCallEnd()
    }

    class IBrain {
        <<interface>>
        +init(harness)
        +onCallStart(callerId, extension)
        +onTranscription(text, isFinal)
        +onDTMFInput(digit)
        +onCallEnd()
        +destroy()
    }

    class IvrTransferAssistant {
        -contactMatcher: ContactMatcher
        -retryManager: RetryManager
        +onCallStart()
        +onTranscription()
        +onDTMFInput()
        +onCallEnd()
    }

    class DirectDialAssistant {
        -contactMatcher: ContactMatcher
        -retryManager: RetryManager
        +onCallStart()
        +onTranscription()
        +onCallEnd()
    }

    class OpenClawAssistant {
        -callerId: string
        +onCallStart()
        +onTranscription()
        +onDTMFInput()
        +onCallEnd()
        +onOpenClawSpeak()
    }

    IAssistant <|.. BaseAssistant
    BaseAssistant <|-- IvrTransferAssistant
    BaseAssistant <|-- DirectDialAssistant
    BaseAssistant <|-- OpenClawAssistant
    BaseAssistant <|-- BrainHarness
    BrainHarness o-- IBrain : delegates to
    IBrain <|.. LlmChatBrain
    IBrain <|.. FlowBrain
    IBrain <|.. IvrTransferBrain
    IBrain <|.. DirectDialBrain
    IBrain <|.. OpenClawBrain
```

### 3. Call Flow Sequence Diagram (IVR Transfer)

```mermaid
sequenceDiagram
    participant Caller
    participant Asterisk
    participant Controller as AriControllerServer
    participant Factory as AssistantFactory
    participant Assistant as IvrTransferAssistant
    participant Parakeet as Parakeet Service

    Caller->>Asterisk: Dials extension 200
    Asterisk->>Controller: StasisStart event

    Controller->>Factory: createFromExtension("200", client, sessionId)
    Factory->>Assistant: new IvrTransferAssistant(client, sessionId)
    Factory-->>Controller: assistant

    Controller->>Assistant: onCallStart(channel, callerId, "200")
    Assistant->>Asterisk: playAudio("custom/welcome_2")
    Asterisk->>Caller: "Welcome, press 1 to speak..."

    Caller->>Asterisk: Presses DTMF "1"
    Asterisk->>Controller: DTMF event
    Controller->>Assistant: onDTMFInput("1")
    Assistant->>Assistant: setState(PROCESSING)
    Assistant->>Asterisk: playAudio("beep")

    Caller->>Asterisk: Speaks "John Smith"
    Asterisk->>Controller: RTP audio
    Controller->>Parakeet: Audio stream
    Parakeet-->>Controller: Transcription

    Controller->>Assistant: onTranscription("John Smith", true)
    Assistant->>Assistant: contactMatcher.findNumberByWords()
    Assistant->>Controller: emit("contactMatched", { number: "100" })
    Controller->>Asterisk: Transfer to ext 100

    Caller->>Asterisk: Hangs up
    Asterisk->>Controller: StasisEnd event
    Controller->>Assistant: onCallEnd(channel)
```

### 4. Extension-to-Assistant Routing

```mermaid
graph LR
    subgraph "Incoming Calls"
        C1[Ext 10x<br/>Direct Dial]
        C2[Ext 20x<br/>IVR Transfer]
        C3[Ext 30x<br/>OpenClaw AI]
        C4[Others<br/>Default]
    end

    subgraph "AssistantFactory"
        Router[Route by Extension<br/>config/routing.json]
    end

    subgraph "Assistants"
        A1[DirectDialAssistant]
        A2[IvrTransferAssistant]
        A3[OpenClawAssistant]
        A4[Default from env]
    end

    C1 --> Router
    C2 --> Router
    C3 --> Router
    C4 --> Router

    Router -->|"10[0-9]"| A1
    Router -->|"20[0-9]"| A2
    Router -->|"30[0-9]"| A3
    Router -->|Other| A4

    style Router fill:#fff4e1
    style A1 fill:#d4edda
    style A2 fill:#d4edda
    style A3 fill:#d4edda
    style A4 fill:#e7f3ff
```

### 5. Assistant State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE

    IDLE --> LISTENING: onCallStart()

    LISTENING --> PROCESSING: onTranscription()
    PROCESSING --> SPEAKING: Action decided
    SPEAKING --> LISTENING: Audio finished

    PROCESSING --> TRANSFERRING: Transfer requested
    TRANSFERRING --> [*]: Call transferred

    LISTENING --> [*]: onCallEnd()
    PROCESSING --> [*]: onCallEnd()
    SPEAKING --> [*]: onCallEnd()

    note right of IDLE
        Initial state
        No active call
    end note

    note right of LISTENING
        Waiting for user input
        Transcription active
    end note

    note right of PROCESSING
        Analyzing transcription
        Deciding action
    end note

    note right of SPEAKING
        Playing audio response
        TTS or pre-recorded
    end note
```

---

## Components

### Directory Structure

```
arilink/
├── assistants/
│   ├── base/
│   │   ├── AssistantTypes.ts          # IAssistant, AssistantConfig, AssistantState
│   │   ├── BaseAssistant.ts           # Abstract base class (playAudio, setState, etc.)
│   │   ├── BrainTypes.ts              # IBrain, IBrainHarness, AgentTool, ToolContext
│   │   └── BrainHarness.ts            # Universal assistant that delegates to a brain
│   │
│   ├── brains/                        # Pluggable brain implementations
│   │   ├── LlmChatBrain.ts           # Streaming LLM + TTS + tool calling
│   │   ├── FlowBrain.ts              # Declarative IVR flow engine (reads flow.json)
│   │   ├── IvrTransferBrain.ts        # DTMF → voice → contact match → transfer
│   │   ├── DirectDialBrain.ts         # Voice → contact match → transfer
│   │   └── OpenClawBrain.ts           # Forward transcriptions to OpenClaw AI
│   │
│   ├── llm-chat/                      # Built-in LLM chat preset
│   │   └── config.json
│   │
│   ├── dentist/                       # Example: LLM assistant
│   │   ├── config.json                # { "brain": "llm-chat", "clinicId": "..." }
│   │   ├── system-prompt.md           # Assistant personality
│   │   ├── guardrails.md              # Topic restrictions (Safety Sandwich)
│   │   ├── knowledge/
│   │   │   ├── hours.md               # Injected into prompt
│   │   │   └── services.md
│   │   ├── tools.json                 # Declarative tools (http/webhook/transfer/shell)
│   │   └── tools/
│   │       └── book-appointment.ts    # Escape hatch: full Node.js module tool
│   │
│   ├── my-ivr/                        # Example: Flow assistant
│   │   ├── config.json                # { "brain": "flow" }
│   │   └── flow.json                  # Visual flow definition (saved by builder)
│   │
│   ├── ivr-transfer/
│   │   ├── IvrTransferAssistant.ts    # Classic assistant (standalone)
│   │   └── config.json
│   │
│   ├── direct-dial/
│   │   ├── DirectDialAssistant.ts     # Classic assistant (standalone)
│   │   └── config.json
│   │
│   ├── openclaw/
│   │   ├── OpenClawAssistant.ts       # Classic assistant (standalone)
│   │   └── config.json
│   │
│   └── auto-dialer-call/
│       ├── AutoDialerCallAssistant.ts
│       └── config.json
│
├── core/
│   ├── AriControllerServer.ts         # Main controller, uses AssistantFactory
│   ├── AssistantFactory.ts            # Creates assistants; reads layers + tools
│   ├── ToolExecutor.ts                # Executes tool calls (http/webhook/shell/module/mcp)
│   ├── TtsClient.ts                   # WebSocket client for Kokoro TTS
│   ├── ElevenLabsTtsClient.ts         # ElevenLabs TTS provider
│   ├── DashboardServer.ts             # Socket.IO hub for dashboard + OpenClaw
│   └── ...
│
├── config/
│   └── routing.json                   # Extension/CallerID → assistant routing rules
│
└── tts-services/
    └── kokoro-service/                # Text-to-Speech microservice
        ├── server.py
        ├── requirements.txt
        └── Dockerfile
```

---

## Two Creation Modes

AriLink supports two ways to create assistants. Both are backwards compatible.

### Mode 1: Classic Assistant (standalone class)

Each assistant is a class that extends `BaseAssistant` and embeds all its logic directly. This is the original approach.

```
AssistantFactory.createByType("ivr-transfer", client, sessionId)
  → loads assistants/ivr-transfer/IvrTransferAssistant.ts
  → new IvrTransferAssistant(client, sessionId)
```

### Mode 2: Brain + BrainHarness (pluggable)

The brain architecture separates **telephony plumbing** (BrainHarness) from **decision logic** (IBrain). A brain is a lightweight class that only handles call flow decisions.

```
config.json: { "brain": "openclaw" }

AssistantFactory.createByType("openclaw", client, sessionId)
  → reads config.json, sees "brain": "openclaw"
  → loads assistants/brains/OpenClawBrain.ts
  → new BrainHarness(config, client, sessionId, contacts, new OpenClawBrain())
```

### When to use which

| Use Case | Approach |
|----------|----------|
| Scripted IVR phone tree (no code, no AI) | FlowBrain — visual drag-and-drop builder |
| AI-powered conversation with tools | LlmChatBrain — streaming LLM + TTS |
| Simple, self-contained logic | Classic assistant |
| Swappable behavior via config | Brain + BrainHarness |
| OpenClaw / AI integration | Brain (OpenClawBrain) |
| Same assistant folder, different brains | Brain (change `"brain"` in config.json) |

---

## Brain Architecture

### IBrain Interface

```typescript
// assistants/base/BrainTypes.ts
export interface IBrain {
  init(harness: IBrainHarness): void;
  onCallStart(callerId: string, extension: string): Promise<void>;
  onTranscription(text: string, isFinal: boolean): Promise<void>;
  onDTMFInput(digit: string): Promise<void>;
  onCallEnd(): Promise<void>;
  onSpeakingDone?(): void;   // Optional: called when TTS finishes
  destroy(): void;
}
```

### IBrainHarness API

Methods available to brains via `this.harness`:

| Method | Description |
|--------|-------------|
| `playAudio(file)` | Play pre-recorded audio (blocks until done) |
| `playAudioNoWait(file)` | Play audio without blocking |
| `playAudioWithFallback(file, fallback)` | Play audio, use fallback if missing |
| `speak(text)` | Synthesize text via TTS and play to caller |
| `transferCall(endpoint)` | Transfer the call |
| `hangup()` | Hang up the call |
| `setState(state)` | Set assistant state |
| `isState(state)` | Check current state |
| `emitEvent(event, data)` | Emit custom event (picked up by controller) |
| `cancelSpeaking()` | Cancel current speech (rejects pending speak() with BargeInError) |
| `sessionId` | Current session ID |
| `config` | Assistant configuration |
| `getContacts()` | Access the contacts database |

### Available Brains

| Brain | Slug | Flow |
|-------|------|------|
| LLM Chat | `llm-chat` | Welcome → listen → streaming LLM → sentence-by-sentence TTS → barge-in |
| Flow | `flow` | Declarative state machine from `flow.json` — zero LLM cost, instant responses |
| IVR Transfer | `ivr-transfer` | Welcome → DTMF gate → voice → contact match → transfer |
| Direct Dial | `direct-dial` | Welcome → voice → contact match → transfer |
| OpenClaw | `openclaw` | Welcome → listen → forward to OpenClaw AI → TTS response |

### Creating a Custom Brain

1. Create `assistants/brains/MyCustomBrain.ts`:

```typescript
const { AssistantState } = require("../base/AssistantTypes");
import type { IBrain, IBrainHarness } from "../base/BrainTypes";

class MyCustomBrain implements IBrain {
  private harness!: IBrainHarness;

  init(harness: IBrainHarness): void {
    this.harness = harness;
  }

  async onCallStart(callerId: string, extension: string): Promise<void> {
    await this.harness.playAudio(this.harness.config.prompts.welcome);
    this.harness.setState(AssistantState.LISTENING);
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    if (!isFinal) return;
    await this.harness.speak("I heard: " + text);
  }

  async onDTMFInput(digit: string): Promise<void> {}
  async onCallEnd(): Promise<void> {}
  destroy(): void {}
}

module.exports.MyCustomBrain = MyCustomBrain;
```

2. Use it in any assistant's `config.json`:

```json
{
  "name": "My Custom Assistant",
  "brain": "my-custom",
  "prompts": { "welcome": "custom/welcome" },
  "behavior": { "maxRetries": 3, "timeoutSeconds": 30, "silenceThresholdSeconds": 5 }
}
```

The slug is auto-derived from the filename: `MyCustomBrain.ts` → `"my-custom"`.

---

## Shared Voice Intelligence

BrainHarness provides voice-quality features that benefit **all brains** automatically, without any brain needing to implement them:

### Filler Sound Filtering

Non-word vocalizations (`um`, `uh`, `mm hmm`, `ah`, `oh`) are filtered before reaching the brain. This prevents brains from generating responses to meaningless sounds.

Real words like "yes", "hello", "ok" are **not** filtered — only genuine non-word vocalizations.

### Turn-End Debouncing

STT often sends multiple rapid-fire final transcriptions for a single utterance (e.g., `"I want to book a"` then `"dentist appointment"` as two finals). BrainHarness debounces these into a single brain call.

- Default debounce: `300ms` (configurable per-agent via `behavior.turnDebounceMs`)
- Post-barge-in debounce: `500ms` (captures full utterance after interruption)

### Barge-In Handling

When the user speaks during bot speech:

1. Rust RTP server detects speech via AEC3 + Silero VAD → fires `user_speaking` event
2. ARI Controller cancels TTS playback → calls `cancelSpeaking()` on BrainHarness
3. BrainHarness rejects pending `speak()` Promise with `BargeInError`
4. Brain's streaming loop catches `BargeInError` and aborts gracefully
5. BrainHarness notifies brain via `onBargeIn(text)` with the interrupting utterance
6. Extended debounce window (500ms) captures the full interrupting utterance

### Interim Transcription Passthrough

Interim (non-final) transcriptions bypass all filtering and debouncing, passing directly to the brain. This is needed by brains like OpenClawBrain that process interim results.

---

## FlowBrain — Declarative IVR Flow Engine

FlowBrain is a deterministic state machine that reads a `flow.json` file and executes it node by node. Zero LLM cost, instant responses, fully predictable.

### How It Works

```
flow.json (saved by visual builder or hand-written)
    ↓
FlowBrain.init() — loads flow definition
    ↓
onCallStart() — sets built-in variables, transitions to startNode
    ↓
transitionTo(nodeId) — executes current node:
    message  → play audio/TTS → auto-advance to next
    menu     → play audio/TTS → wait for DTMF → branch by key
    collect  → play audio/TTS → wait for speech → store in variable → advance
    condition → evaluate variable → branch true/false
    transfer → transfer the call
    hangup   → play goodbye → hang up
    http_request → call external API → store result → advance
    set_variable → assign value → advance
    trigger  → pass-through entry point → advance
```

### Audio & Speech Pipeline

The STT pipeline (Parakeet/Google) runs continuously during the call — audio is always streaming. FlowBrain uses the **assistant state** as a gate:

- **SPEAKING** — FlowBrain is playing audio or TTS. Transcriptions arrive but are ignored.
- **LISTENING** — FlowBrain is waiting for input. Transcriptions and DTMF are processed.
- **PROCESSING** — FlowBrain is executing an HTTP request. Input is ignored.

This is the same mechanism used by LlmChatBrain. The difference is what happens with the input:
- LLM brain sends transcriptions to the AI model for open-ended conversation
- Flow brain stores transcriptions in a variable and advances to the next node

### Node Types

| Type | Fields | Runtime Behavior |
|------|--------|-----------------|
| `trigger` | — | Entry point, pass-through to next node. Shows built-in variables in UI. |
| `message` | `audio`, `text`, `next` | Play audio (TTS fallback), auto-transition to `next` |
| `menu` | `audio`, `text`, `options`, `timeout` | Play audio, wait for DTMF, branch by key. Retries on invalid/no input. |
| `collect` | `audio`, `text`, `next`, `variable` | Play audio, wait for speech, store in variable, go to `next` |
| `condition` | `variable`, `operator`, `compareValue`, `trueNext`, `falseNext` | Evaluate variable, branch true/false |
| `transfer` | `extension` | Transfer the call to an extension |
| `hangup` | `audio`, `text` | Optional goodbye audio, then hang up |
| `http_request` | `method`, `url`, `headersJson`, `bodyJson`, `resultVariable`, `next` | Call external API, store response, advance |
| `set_variable` | `variable`, `value`, `next` | Assign a value to a variable, advance |

### Variables

Variables are string key-value pairs stored in memory during a call. They can be referenced in text fields using `{{variable}}` syntax.

**Built-in variables** (set automatically at call start):

| Variable | Description |
|----------|-------------|
| `{{caller}}` | Caller ID |
| `{{extension}}` | Dialed extension |
| `{{date}}` | Current date (locale format) |
| `{{time}}` | Current time (HH:MM) |
| `{{timestamp}}` | ISO 8601 timestamp |
| `{{digit}}` | Last DTMF key pressed |

**User-defined variables** are created by:
- **Collect** node — stores speech transcription
- **Set Variable** node — assigns a static or interpolated value
- **HTTP Request** node — stores API response

Variable interpolation (`{{var}}`) works in: TTS text, HTTP URL, HTTP headers, HTTP body, Set Variable value, and Condition compare value.

### Condition Operators

| Operator | Description |
|----------|-------------|
| `equals` | Exact string match |
| `not_equals` | Not equal |
| `contains` | Substring match |
| `not_empty` | Variable has a value |
| `empty` | Variable is empty or unset |
| `gt` | Numeric greater than |
| `lt` | Numeric less than |

### Menu Timeout & Retries

Menu nodes support configurable timeout behavior:
- `timeout.seconds` — how long to wait for DTMF (default: 10s)
- `timeout.retries` — max replay attempts before giving up (default: 3)
- `timeout.next` — fallback node when retries exhausted (or falls back to `node.next`)

Invalid DTMF keys also count as retries and replay the menu prompt.

### flow.json Format

```json
{
  "startNode": "welcome",
  "nodes": {
    "trigger_1": {
      "type": "trigger",
      "label": "Call Start",
      "next": "welcome",
      "position": { "x": 250, "y": 0 }
    },
    "welcome": {
      "type": "message",
      "label": "Welcome",
      "audio": "custom/welcome",
      "text": "Welcome to our service.",
      "next": "main_menu",
      "position": { "x": 250, "y": 150 }
    },
    "main_menu": {
      "type": "menu",
      "label": "Main Menu",
      "text": "Press 1 for sales, 2 for support, 0 for operator.",
      "options": { "1": "sales", "2": "support", "0": "operator" },
      "timeout": { "seconds": 10, "retries": 3, "next": "goodbye" },
      "next": "goodbye",
      "position": { "x": 250, "y": 300 }
    },
    "operator": {
      "type": "transfer",
      "label": "Operator",
      "extension": "200",
      "position": { "x": 500, "y": 450 }
    },
    "goodbye": {
      "type": "hangup",
      "label": "Goodbye",
      "text": "Thank you for calling. Goodbye!",
      "position": { "x": 250, "y": 550 }
    }
  }
}
```

### Visual Flow Builder

Flow brain assistants have a visual drag-and-drop editor in the dashboard (Flow tab) built with `@vue-flow/core`. The editor:

- Renders each node type as a custom Vue component with inline editing
- Connects nodes via draggable edges (handles on node borders)
- Auto-creates a Trigger node as the flow entry point
- Serializes the canvas to `flow.json` on save, deserializes on load
- Variable picker shows only variables reachable from upstream nodes
- Audio picker loads available sound files from the Assets API

The Code and Prompt tabs are hidden for flow brains since the logic is entirely visual.

### Dashboard Tabs for Flow Brains

| Tab | Content |
|-----|---------|
| **Flow** | Visual flow builder canvas |
| **Config** | config.json editor (name, brain, language, etc.) |

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/assistants/[slug]/flow` | Read flow.json |
| `PUT /api/assistants/[slug]/flow` | Validate and write flow.json |

---

## Routing

### config/routing.json

```json
{
  "defaultAssistant": "ivr-transfer",
  "extensionRoutes": [
    { "pattern": "10[0-9]", "assistant": "direct-dial" },
    { "pattern": "20[0-9]", "assistant": "ivr-transfer" },
    { "pattern": "30[0-9]", "assistant": "openclaw" }
  ],
  "callerIdRoutes": [
    { "pattern": "\\+48.*", "assistant": "ivr-transfer" }
  ]
}
```

Patterns are regex. The factory tries routes in order, falls back to `defaultAssistant`.

### AssistantFactory Methods

```typescript
// Route by extension (reads routing.json)
AssistantFactory.createFromExtension("301", client, sessionId);
// → matches "30[0-9]" → creates openclaw assistant

// Route by caller ID
AssistantFactory.createFromCallerId("+48123456789", client, sessionId);

// Explicit type (bypasses routing.json)
AssistantFactory.createByType("openclaw", client, sessionId);

// Reload routing config after editing
AssistantFactory.reloadRouting();
```

### Dynamic Discovery

The factory automatically discovers assistants by scanning the `assistants/` directory. Any subfolder with a `*Assistant.ts` file is registered. Brains are discovered from `assistants/brains/*Brain.ts`. No imports or switch statements needed.

---

## Configuration

### Assistant config.json

Each assistant folder has a `config.json`:

```json
{
  "name": "IVR Transfer",
  "mode": "incoming",
  "brain": "ivr-transfer",
  "language": "en-US",
  "prompts": {
    "welcome": "custom/welcome_2",
    "goodbye": "custom/goodbye",
    "error": "custom/error",
    "timeout": "custom/timeout",
    "tryAgain": "custom/try_again"
  },
  "behavior": {
    "maxRetries": 12,
    "timeoutSeconds": 30,
    "silenceThresholdSeconds": 5,
    "transferDigit": "1",
    "maxNoMatches": 12,
    "tryAgainInterval": 3
  },
  "transfer": {
    "destination": "100",
    "trunk": "from-internal"
  }
}
```

| Field | Description |
|-------|-------------|
| `name` | Display name |
| `mode` | `"incoming"` or `"outbound"` |
| `brain` | Brain slug (optional — omit for classic assistant) |
| `language` | Speech recognition language |
| `prompts` | Audio file references (`sound:custom/...`) |
| `behavior` | Retry counts, timeouts, DTMF settings |
| `transfer` | Default transfer destination and trunk |
| `campaign` | Campaign settings (outbound only) |

### Environment Variables

```env
# Default assistant for unmatched extensions
DEFAULT_ASSISTANT=ivr-transfer

# TTS service (required for brains that use speak())
TTS_SERVICE=ws://localhost:5001
TTS_VOICE=af_heart
TTS_SPEED=1.0
```

---

## Tool Calling

LLM-based assistants (using `LlmChatBrain`) can call external tools: HTTP APIs, webhooks, shell commands, Node.js modules, and MCP servers.

### How it works

```
LLM response with finish_reason: "tool_calls"
    ↓
ToolExecutor.execute(name, args)    ← core/ToolExecutor.ts
    ↓  (http / webhook / transfer / hangup / shell / module / mcp)
Result → wrapped in <tool_result> tags → pushed to history
    ↓
LLM called again → speaks response
    (loop up to MAX_TOOL_TURNS = 5)
```

### Configuring tools

Each assistant can have:
- **`tools.json`** — declarative tools (no code needed)
- **`tools/*.ts`** — module tools (full Node.js, auto-discovered)
- **`mcpServers` in config.json** — MCP servers (tools auto-discovered at call start)

### Handler types

| Type | What it does |
|------|-------------|
| `http` | `fetch()` GET/POST with template variable substitution |
| `webhook` | POST all LLM args as JSON to a URL |
| `transfer` | `harness.transferCall(extension)` |
| `hangup` | `harness.hangup()` |
| `shell` | `child_process.exec()` with timeout, stdout as result |
| `module` | `require(file).execute(args, ctx)` — full Node.js |
| `mcp` | JSON-RPC 2.0 POST to MCP server |

See [AGENT-TOOLS.md](AGENT-TOOLS.md) for full documentation, examples, and the dentist assistant walkthrough.

---

## Related Documentation

- [Agent Tools](AGENT-TOOLS.md) — Tool calling, MCP servers, module tools, full examples
- [AI Safety Guardrails](AI-SAFETY-GUARDRAILS.md) — Prompt injection, spotlighting, Safety Sandwich
- [Security Guide](SECURITY.md) — Auth, SSRF protection, path traversal, env vars
- [OpenClaw Integration](OPENCLAW-INTEGRATION.md) — Connect AriLink to OpenClaw AI agents
- [Docker Setup](docker.md) — Run the full stack with Docker
- [FreePBX Setup](freepbx-setup.md) — FreePBX configuration
- [Dialplan Config](DIALPLAN-CONFIG.md) — Call routing setup
- [Transcription Services](TRANSCRIPTION-SERVICES.md) — Speech-to-text backends

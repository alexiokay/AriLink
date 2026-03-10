# Agent Tools — Tool Calling for LLM Assistants

Gives any LLM-based assistant the ability to call external APIs, run webhooks, execute shell commands, or run arbitrary Node.js code — all driven by the LLM via OpenAI-compatible function calling.

---

## How It Works

```
Caller speaks
    ↓
LlmChatBrain → LLM API (sends tool definitions)
    ↓
LLM responds with tool_calls (JSON: which tool + args)
    ↓
ToolExecutor.execute(name, args)
    ↓
Result injected into conversation history
    ↓
LLM called again with tool result → speaks response
```

The loop runs up to **5 turns** (`MAX_TOOL_TURNS`) to prevent infinite loops. Transfer/hangup tool results break the loop immediately.

---

## File Structure

```
assistants/dentist/
  config.json          ← "brain": "llm-chat" required
  system-prompt.md     ← describe the assistant's role
  guardrails.md        ← topic restrictions
  knowledge/
    hours.md           ← clinic hours
    services.md        ← available treatments
  tools.json           ← declarative tools (http, webhook, transfer, hangup, shell)
  tools/
    book-appointment.ts  ← escape hatch: arbitrary Node.js
```

Both `tools.json` and `tools/*.ts` are optional and can be combined.

---

## tools.json Format

An array of tool definitions:

```json
[
  {
    "name": "check_availability",
    "description": "Check open appointment slots. Call when the caller asks about times or wants to book.",
    "parameters": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "description": "Date as natural language: 'Monday', 'tomorrow', 'March 5'"
        },
        "service": {
          "type": "string",
          "description": "Type of appointment (cleaning, filling, etc.)"
        }
      },
      "required": ["date"]
    },
    "handler": {
      "type": "http",
      "method": "GET",
      "url": "https://cal.example.com/api/slots",
      "query": {
        "date": "{{date}}",
        "service": "{{service}}",
        "clinic": "{{config.clinicId}}"
      },
      "headers": {
        "Authorization": "Bearer {{env.CAL_API_KEY}}"
      }
    }
  }
]
```

### Tool Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (no spaces — use underscores) |
| `description` | Yes | Tells the LLM **when** to call this tool. Be specific. |
| `parameters` | Yes | JSON Schema for the tool's input arguments |
| `handler` | Yes | How to execute the tool (see Handler Types below) |

---

## Handler Types

### `http` — Fetch a URL

```json
{
  "type": "http",
  "method": "GET",
  "url": "https://api.example.com/slots",
  "query": { "date": "{{date}}" },
  "headers": { "Authorization": "Bearer {{env.API_KEY}}" },
  "body": { "clinic": "{{config.clinicId}}", "date": "{{date}}" },
  "timeout": 10000
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `method` | `GET` | HTTP method |
| `url` | — | Request URL |
| `query` | — | Query string params (key-value, templated) |
| `headers` | — | Request headers (key-value, templated) |
| `body` | — | JSON body (POST/PUT). If omitted on POST, all args are sent as body. |
| `timeout` | `10000` | Timeout in ms |

---

### `webhook` — POST all args to a URL

```json
{
  "type": "webhook",
  "url": "https://hooks.example.com/new-booking",
  "headers": { "X-Secret": "{{env.WEBHOOK_SECRET}}" },
  "timeout": 10000
}
```

Posts `{ ...args, _callerId, _sessionId }` as JSON to the URL. The response body is returned to the LLM (capped at 2000 chars).

---

### `transfer` — Transfer the call

```json
{
  "type": "transfer",
  "extension": "200"
}
```

Calls `harness.transferCall(extension)` and ends the tool loop. Use `{{config.receptionistExt}}` for dynamic extensions.

---

### `hangup` — End the call

```json
{
  "type": "hangup"
}
```

Calls `harness.hangup()` and ends the tool loop.

---

### `shell` — Run a shell command

```json
{
  "type": "shell",
  "command": "python3 /scripts/lookup.py {{phone}}",
  "timeout": 5000
}
```

Executes in a child process. `stdout` is returned to the LLM. LLM-supplied arguments are **single-quoted** before substitution to prevent shell injection.

> **Security:** Never include sensitive values in the command string itself. Use `{{env.KEY}}` for secrets.

---

### `module` — Full Node.js escape hatch

```json
{
  "type": "module",
  "file": "tools/book-appointment.ts"
}
```

Loads `assistants/<slug>/tools/book-appointment.ts` and calls `execute(args, ctx)`.

> **Security:** Path must be relative and cannot escape the assistant directory.

---

### `mcp` — Model Context Protocol server

MCP tools are configured separately (see [MCP Servers](#mcp-servers) below). You don't add them to `tools.json` manually.

---

## Template Variables

Available in `url`, `headers`, `query`, `body`, and `command` fields:

| Syntax | Source |
|--------|--------|
| `{{argName}}` | Tool call argument from the LLM |
| `{{config.key}}` | Field from the assistant's `config.json` |
| `{{env.KEY_NAME}}` | `process.env.KEY_NAME` — never hardcode secrets |

Example:
```json
"url": "https://api.example.com/{{config.clinicId}}/slots?date={{date}}&key={{env.CAL_API_KEY}}"
```

---

## Module Tools (Escape Hatch)

For any logic that can't be expressed declaratively — database queries, complex transformations, multi-step API calls, etc.

### Auto-discovery (no tools.json entry needed)

If a `.ts` file in `tools/` exports a `definition` object, AssistantFactory auto-registers it:

```typescript
// assistants/dentist/tools/check-availability.ts

export const definition = {
  name: "check_availability",
  description: "Check available appointment slots. Call when caller asks about booking.",
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "Natural date like 'Monday' or 'tomorrow'" }
    },
    required: ["date"]
  }
};

export async function execute(
  args: { date: string },
  ctx: ToolContext
): Promise<string> {
  // ctx.callerId  — caller's phone number
  // ctx.sessionId — ARI session ID
  // ctx.config    — assistant config.json content
  // ctx.env       — process.env

  const res = await fetch(`https://your-api.com/slots?date=${args.date}`, {
    headers: { Authorization: `Bearer ${ctx.env.CAL_API_KEY}` }
  });
  const data = await res.json();

  if (!data.slots?.length) return "No slots available on that date.";
  return `Available on ${args.date}: ${data.slots.join(", ")}`;
}
```

### ToolContext

```typescript
interface ToolContext {
  callerId: string;        // Caller's phone number / channel ID
  sessionId: string;       // ARI session ID
  config: any;             // assistant config.json
  env: NodeJS.ProcessEnv;  // process.env
}
```

### Call control from module tools

Module tools don't have direct harness access, but they can signal the brain:

```typescript
// Transfer the call
return "__transfer__:200";

// Hang up
return "__hangup__";

// Normal result
return "Appointment booked for Monday at 10 AM. Confirmation: #ABC123";
```

---

## MCP Servers

MCP (Model Context Protocol) servers expose a set of tools via HTTP JSON-RPC. Tools are **auto-discovered at call start** — no `tools.json` entry needed.

### Configuring via Dashboard

1. Open the assistant → **Prompt** tab → scroll to **Tools** section
2. Under **MCP Servers**, click **Add Server**
3. Enter the server URL (e.g., `http://localhost:3100`)
4. Save — tools from the server appear automatically on the next call

### Configuring via config.json

```json
{
  "name": "Dentist",
  "brain": "llm-chat",
  "mcpServers": [
    { "url": "http://localhost:3100", "name": "Cal.com" },
    { "url": "https://mcp.calapi.example.com", "name": "Calendar" }
  ]
}
```

### How MCP tools are discovered

At `onCallStart()`:
1. `LlmChatBrain` calls `tools/list` on each configured MCP server (5s timeout)
2. Returned tools are merged with static tools from `tools.json`
3. All tools are passed to the LLM as function definitions
4. When the LLM calls an MCP tool, `ToolExecutor.runMcp()` POSTs `tools/call` to the server

### Ready-made MCP servers

| Service | MCP Server |
|---------|-----------|
| Cal.com | Official MCP at `cal.com/mcp` |
| Google Calendar | `@modelcontextprotocol/server-google-calendar` |
| Microsoft 365 | `@modelcontextprotocol/server-outlook` |
| Custom REST API | Wrap with any MCP SDK in ~50 lines |

---

## Writing Good Tool Descriptions

The description is **the most important field**. The LLM uses it to decide when to call the tool.

**Bad:**
```
"description": "Gets slots"
```

**Good:**
```
"description": "Check available appointment slots. Call this when the caller asks what times are available, when they can come in, or when they want to book an appointment. Requires a date."
```

Tips:
- Say **when** to call it, not just what it does
- Mention what **triggers** should cause the LLM to call it
- For tools that need confirmation (book, cancel), say: "Only call after confirming X and Y with the caller"

---

## Full Example: Dentist Assistant

### config.json
```json
{
  "name": "Dental Clinic",
  "brain": "llm-chat",
  "mode": "incoming",
  "clinicId": "smile-dental-01",
  "receptionistExt": "200"
}
```

### system-prompt.md
```
You are a friendly receptionist at Smile Dental Clinic.
Help callers book, reschedule, or cancel appointments.
Keep responses to 1-2 sentences. You are on the phone — no formatting.
Always confirm the patient's name before booking.
```

### guardrails.md
```
Only assist with dental clinic topics: appointments, hours, services, location.
Never provide medical diagnoses or clinical advice.
If the caller asks about anything unrelated, politely redirect to clinic matters.
```

### tools.json
```json
[
  {
    "name": "check_availability",
    "description": "Check open appointment slots. Call when caller asks about available times or wants to book. Requires a date.",
    "parameters": {
      "type": "object",
      "properties": {
        "date": { "type": "string", "description": "Date like 'Monday' or 'March 5'" }
      },
      "required": ["date"]
    },
    "handler": {
      "type": "http",
      "method": "GET",
      "url": "https://your-calendar.com/api/slots",
      "query": { "date": "{{date}}", "clinicId": "{{config.clinicId}}" },
      "headers": { "Authorization": "Bearer {{env.CALENDAR_API_KEY}}" }
    }
  },
  {
    "name": "book_appointment",
    "description": "Book an appointment. Only call after confirming date, time, and patient name with the caller.",
    "parameters": {
      "type": "object",
      "properties": {
        "date": { "type": "string" },
        "time": { "type": "string" },
        "patient_name": { "type": "string" },
        "service": { "type": "string", "description": "E.g. 'cleaning', 'filling'" }
      },
      "required": ["date", "time", "patient_name"]
    },
    "handler": {
      "type": "http",
      "method": "POST",
      "url": "https://your-calendar.com/api/bookings",
      "headers": { "Authorization": "Bearer {{env.CALENDAR_API_KEY}}" }
    }
  },
  {
    "name": "transfer_to_receptionist",
    "description": "Transfer to a human receptionist. Use when the caller has complex questions, is upset, or explicitly asks to speak with a person.",
    "parameters": { "type": "object", "properties": {} },
    "handler": { "type": "transfer", "extension": "{{config.receptionistExt}}" }
  }
]
```

---

## Security Notes

- **SSRF protection**: `http` and `webhook` handlers block requests to private/internal IPs (`10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`, `127.x`). Set `ALLOW_PRIVATE_TOOL_URLS=true` in `.env` for local dev only.
- **Shell injection**: LLM-supplied arguments in `shell` commands are single-quoted automatically.
- **Path containment**: `module` tool files must be relative paths within the assistant directory.
- **Spotlighting**: Tool results are wrapped in `<tool_result>` tags and the system prompt instructs the LLM to treat them as raw data (indirect prompt injection mitigation).
- **MCP URL validation**: Only `http://` and `https://` MCP server URLs are accepted.

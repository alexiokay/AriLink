# Model Context Protocol (MCP) Server

AriLink exposes a built-in MCP server that lets AI agents interact with your phone system — query call history, check service status, manage campaigns, transfer calls, and more.

**Endpoint:** `http://localhost:3011/mcp`

**Transport:** Streamable HTTP (modern single-endpoint protocol)

## Configuration

Enable or disable the MCP server:

- **Dashboard:** Settings > Config > Integrations > MCP Server toggle
- **Environment variable:** `MCP_ENABLED=true` (default) or `MCP_ENABLED=false` in `.env`
- **Runtime API:** `POST /api/mcp-toggle` with `{ "enabled": true/false }`

## Client Setup

### Claude Code

```bash
claude mcp add arilink --transport http http://localhost:3011/mcp
```

### VS Code

`.vscode/mcp.json`

```json
{
  "servers": {
    "arilink": {
      "url": "http://localhost:3011/mcp",
      "type": "http"
    }
  }
}
```

### Claude Desktop

`claude_desktop_config.json`

```json
{
  "mcpServers": {
    "arilink": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3011/mcp"]
    }
  }
}
```

### Cline

`cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "arilink": {
      "url": "http://localhost:3011/mcp",
      "type": "streamableHttp",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Cursor

Settings > MCP > Add Server

```json
{
  "mcpServers": {
    "arilink": {
      "url": "http://localhost:3011/mcp",
      "type": "http"
    }
  }
}
```

### Windsurf

```json
{
  "mcpServers": {
    "arilink": {
      "serverUrl": "http://localhost:3011/mcp"
    }
  }
}
```

### OpenCode

```bash
opencode mcp add arilink --transport http http://localhost:3011/mcp
```

### Ollama (via ollmcp)

```bash
uvx ollmcp -u http://localhost:3011/mcp
```

## Available Tools (27 total)

### Call Data

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_metrics` | Call statistics — totals, success rate, daily breakdown, top assistants/callers | `days?` |
| `get_calls` | Call history with search and pagination | `limit?`, `offset?`, `search?` |
| `get_call_detail` | Full call detail with transcriptions and event timeline | `callId` |
| `get_active_calls` | Currently active phone calls | — |

### System

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_service_status` | Status of Asterisk, Rust RTP, and Transcription services | — |
| `get_extensions` | List PBX extensions with registration state | — |
| `get_logs` | Server console log entries with pagination | `limit?`, `before?` |
| `reconnect_service` | Reconnect Asterisk ARI or restart transcription | `service` (`ari`, `transcription`, `parakeet`) |

### Assistants

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_assistants` | All AI assistants with their configurations | — |
| `get_assistant_config` | Full config JSON for a specific assistant | `slug` |
| `switch_assistant` | Change the active assistant for incoming calls | `slug` |
| `update_assistant_config` | Modify an assistant's configuration | `slug`, `config` |

### Contacts & Campaigns

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_contacts` | All contact/phone lists (metadata) | — |
| `get_contact_list` | Full contents of a contact list | `id` |
| `create_contact_list` | Create or update a contact list | `name`, `entries`, `id?` |
| `delete_contact_list` | Delete a contact list | `id` |
| `list_campaigns` | Completed campaign results (name, date, summary) | — |
| `get_campaign_status` | Active campaign progress and results | — |
| `get_campaign_results` | Full results from a completed campaign | `file` |

### Call Actions

| Tool | Description | Parameters |
|------|-------------|------------|
| `hangup_call` | Hang up an active call | `sessionId` |
| `transfer_call` | Transfer a call to another endpoint | `sessionId`, `endpoint` |

### Campaign Actions

| Tool | Description | Parameters |
|------|-------------|------------|
| `pause_campaign` | Pause the running campaign | — |
| `resume_campaign` | Resume a paused campaign | — |
| `stop_campaign` | Stop the campaign completely | — |

### Routing

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_routing` | Current call routing rules | — |
| `update_routing` | Update call routing rules | `defaultAssistant`, `extensionRoutes?`, `callerIdRoutes?` |

## Testing

Use the MCP Inspector to test tools interactively:

```bash
npx @modelcontextprotocol/inspector http://localhost:3011/mcp
```

## Usage Examples

Once connected, ask your AI agent:

- *"What's the status of my phone system?"* → calls `get_service_status`
- *"Show me today's call statistics"* → calls `get_metrics`
- *"Find calls from +48123456789"* → calls `get_calls` with search
- *"Show the full transcript for call abc123"* → calls `get_call_detail`
- *"List all available assistants"* → calls `list_assistants`
- *"Hang up the active call"* → calls `get_active_calls` then `hangup_call`
- *"How is the campaign going?"* → calls `get_campaign_status`
- *"Switch to the receptionist assistant"* → calls `switch_assistant`
- *"Create a VIP contact list with +48123..."* → calls `create_contact_list`
- *"Show me the routing rules"* → calls `get_routing`
- *"Which extensions are online?"* → calls `get_extensions`
- *"Show results from the last campaign"* → calls `list_campaigns` then `get_campaign_results`

## Security

The MCP server has **no authentication**. It is intended for local use or trusted networks.

**Not exposed for security reasons:** environment variables (contain passwords/API keys), backup export/import, code editing.

For production use over a network, place behind a reverse proxy with authentication.

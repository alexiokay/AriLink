// MCP (Model Context Protocol) server — exposes AriLink capabilities as tools
// for external AI agents (Claude Desktop, Claude Code, etc.)
//
// Session management: one McpServer + StreamableHTTPServerTransport per client session.
// Route handlers in server/routes/mcp.*.ts delegate to these functions.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

// ── Enable/disable flag ──

export let mcpEnabled = process.env.MCP_ENABLED !== "false"; // on by default

export function setMcpEnabled(value: boolean) {
  mcpEnabled = value;
  if (!value) {
    // Close all active sessions when disabling
    for (const [id, session] of sessions) {
      session.transport.close();
      session.server.close();
      sessions.delete(id);
    }
  }
  console.log(`[MCP] ${value ? "Enabled" : "Disabled"}`);
}

// ── Session storage ──

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

const sessions = new Map<string, McpSession>();

export function getMcpSession(sessionId: string): McpSession | undefined {
  return sessions.get(sessionId);
}

export async function createMcpSession(): Promise<McpSession> {
  const server = new McpServer(
    { name: "arilink", version: "1.0.0" },
    { capabilities: { logging: {} } },
  );

  registerTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id: string) => {
      sessions.set(id, { server, transport });
      console.log(`[MCP] Session created: ${id}`);
    },
    onsessionclosed: (id: string) => {
      sessions.delete(id);
      console.log(`[MCP] Session closed: ${id}`);
    },
  });

  await server.connect(transport);
  return { server, transport };
}

// ── Helper ──

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

function getProjectRoot(): string {
  const config = useRuntimeConfig();
  return config.projectRoot as string;
}

// ── Tool registrations ──

function registerTools(server: McpServer) {
  // ─── Read-only data tools ───

  server.registerTool("get_metrics", {
    description: "Get call metrics and statistics (total calls, success rate, daily breakdown, top assistants/callers)",
    inputSchema: {
      days: z.number().optional().describe("Number of days to look back (default 7)"),
    },
  }, async ({ days }) => {
    if (!serverState.callHistory) return err("Call history not initialized");
    return ok(serverState.callHistory.getMetrics(days ?? 7));
  });

  server.registerTool("get_calls", {
    description: "Get call history with optional search and pagination",
    inputSchema: {
      limit: z.number().optional().describe("Max results (default 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
      search: z.string().optional().describe("Search by caller ID, name, or assistant"),
    },
  }, async ({ limit, offset, search }) => {
    if (!serverState.callHistory) return err("Call history not initialized");
    return ok(serverState.callHistory.getCalls({ limit, offset, search }));
  });

  server.registerTool("get_call_detail", {
    description: "Get full details for a specific call including transcriptions and events timeline",
    inputSchema: {
      callId: z.string().describe("The call/session ID"),
    },
  }, async ({ callId }) => {
    if (!serverState.callHistory) return err("Call history not initialized");
    const call = serverState.callHistory.getCall(callId);
    if (!call) return err(`Call ${callId} not found`);
    const transcriptions = serverState.callHistory.getCallTranscriptions(callId);
    const events = serverState.callHistory.getCallEvents(callId);
    return ok({ call, transcriptions, events });
  });

  server.registerTool("get_active_calls", {
    description: "Get currently active phone calls with session details",
  }, async () => {
    if (!serverState.dashboard) return err("Dashboard not initialized");
    const calls = (serverState.dashboard as any).getActiveCalls();
    return ok(calls ?? []);
  });

  server.registerTool("get_service_status", {
    description: "Get status of all backend services (Asterisk PBX, Rust RTP server, Transcription engine)",
  }, async () => {
    if (!serverState.dashboard) return err("Dashboard not initialized");
    return ok((serverState.dashboard as any).serviceState ?? {});
  });

  server.registerTool("get_logs", {
    description: "Get server log entries (console output) with pagination",
    inputSchema: {
      limit: z.number().optional().describe("Max entries to return (default 100)"),
      before: z.number().optional().describe("Get entries before this log ID (for pagination)"),
    },
  }, async ({ limit, before }) => {
    const lc = (serverState.dashboard as any)?.logCollector;
    if (!lc) return err("Log collector not initialized");
    return ok(lc.getEntries(limit ?? 100, before));
  });

  server.registerTool("list_assistants", {
    description: "List all available AI assistants with their configuration (name, mode, description, language)",
  }, async () => {
    const rootDir = getProjectRoot();
    const assistantsDir = resolve(rootDir, "assistants");
    if (!existsSync(assistantsDir)) return err("Assistants directory not found");

    const entries = readdirSync(assistantsDir);
    const assistants = [];
    for (const entry of entries) {
      if (entry === "base") continue;
      const dirPath = join(assistantsDir, entry);
      if (!statSync(dirPath).isDirectory()) continue;
      const configPath = join(dirPath, "config.json");
      if (!existsSync(configPath)) continue;
      try {
        const raw = readFileSync(configPath, "utf-8");
        assistants.push({ slug: entry, config: JSON.parse(raw) });
      } catch {
        assistants.push({ slug: entry, config: null });
      }
    }
    return ok({ assistants });
  });

  server.registerTool("get_assistant_config", {
    description: "Get the full configuration JSON for a specific assistant",
    inputSchema: {
      slug: z.string().describe("Assistant slug/directory name (e.g. 'receptionist', 'auto-dialer-call')"),
    },
  }, async ({ slug }) => {
    const rootDir = getProjectRoot();
    const configPath = resolve(rootDir, "assistants", slug, "config.json");
    if (!existsSync(configPath)) return err(`Assistant "${slug}" not found`);
    return ok(JSON.parse(readFileSync(configPath, "utf-8")));
  });

  server.registerTool("list_contacts", {
    description: "List all contact/phone lists (metadata: name, entry count, creation date)",
  }, async () => {
    const rootDir = getProjectRoot();
    const listsDir = resolve(rootDir, "contact-lists");
    if (!existsSync(listsDir)) return ok({ lists: [] });

    const files = readdirSync(listsDir).filter((f) => f.endsWith(".json")).sort().reverse();
    const lists = [];
    for (const file of files.slice(0, 100)) {
      try {
        const raw = readFileSync(join(listsDir, file), "utf-8");
        const data = JSON.parse(raw);
        lists.push({
          id: data.id || file.replace(".json", ""),
          name: data.name || "",
          count: Array.isArray(data.entries) ? data.entries.length : 0,
          createdAt: data.createdAt || "",
        });
      } catch {
        // skip corrupted files
      }
    }
    return ok({ lists });
  });

  server.registerTool("get_contact_list", {
    description: "Get the full contents (phone numbers/entries) of a specific contact list",
    inputSchema: {
      id: z.string().describe("Contact list ID (from list_contacts)"),
    },
  }, async ({ id }) => {
    const rootDir = getProjectRoot();
    const filePath = resolve(rootDir, "contact-lists", `${id}.json`);
    if (!existsSync(filePath)) return err(`Contact list "${id}" not found`);
    return ok(JSON.parse(readFileSync(filePath, "utf-8")));
  });

  server.registerTool("get_campaign_status", {
    description: "Get current auto-dialer campaign status (progress, active calls, results)",
  }, async () => {
    if (!serverState.autoDialer) return ok({ status: "no_campaign" });
    return ok(serverState.autoDialer.getStatus());
  });

  server.registerTool("get_campaign_results", {
    description: "Get full results from a completed campaign (call outcomes, summary stats)",
    inputSchema: {
      file: z.string().describe("Campaign result filename (from campaigns list)"),
    },
  }, async ({ file }) => {
    const rootDir = getProjectRoot();
    const filePath = resolve(rootDir, "campaign-results", file);
    if (!existsSync(filePath)) return err(`Campaign result "${file}" not found`);
    return ok(JSON.parse(readFileSync(filePath, "utf-8")));
  });

  server.registerTool("list_campaigns", {
    description: "List completed campaign results (name, date, summary)",
  }, async () => {
    const rootDir = getProjectRoot();
    const resultsDir = resolve(rootDir, "campaign-results");
    if (!existsSync(resultsDir)) return ok({ campaigns: [] });

    const files = readdirSync(resultsDir).filter((f) => f.endsWith(".json")).sort().reverse();
    const campaigns = [];
    for (const file of files.slice(0, 50)) {
      try {
        const raw = readFileSync(join(resultsDir, file), "utf-8");
        const data = JSON.parse(raw);
        campaigns.push({
          file,
          name: data.campaignName || "",
          assistantSlug: data.assistantSlug || "",
          date: data.campaignDate,
          totalNumbers: data.totalNumbers,
          totalProcessed: data.totalProcessed,
          summary: data.summary || {},
        });
      } catch { /* skip */ }
    }
    return ok({ campaigns });
  });

  server.registerTool("get_extensions", {
    description: "List PBX extensions (PJSIP endpoints) with registration state and active channels",
  }, async () => {
    const pbxIP = process.env.PBX_IP;
    const login = process.env.ASTERISK_LOGIN;
    const password = process.env.ASTERISK_PASSWORD;
    if (!pbxIP) return err("PBX_IP not configured");
    if (!login || !password) return err("Asterisk credentials not configured");

    try {
      const url = `http://${pbxIP}:8088/ari/endpoints/PJSIP`;
      const auth = Buffer.from(`${login}:${password}`).toString("base64");
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return err(`ARI returned ${res.status}`);
      const data = (await res.json()) as any[];
      const extensions = data.map((ep) => ({
        resource: ep.resource || "",
        state: ep.state || "unknown",
        channel_ids: ep.channel_ids || [],
      })).sort((a, b) => {
        const na = parseInt(a.resource, 10);
        const nb = parseInt(b.resource, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.resource.localeCompare(b.resource);
      });
      return ok({ extensions });
    } catch (e: any) {
      return err(`Failed to query ARI: ${e.message}`);
    }
  });

  server.registerTool("get_routing", {
    description: "Get current incoming call routing rules (default assistant, extension and caller ID routes)",
  }, async () => {
    const rootDir = getProjectRoot();
    const routingPath = resolve(rootDir, "config", "routing.json");
    if (!existsSync(routingPath)) {
      return ok({ extensionRoutes: [], callerIdRoutes: [] });
    }
    return ok(JSON.parse(readFileSync(routingPath, "utf-8")));
  });

  // ─── Action tools ───

  server.registerTool("switch_assistant", {
    description: "Change the active assistant for incoming calls",
    inputSchema: {
      slug: z.string().describe("Assistant slug to activate (from list_assistants)"),
    },
  }, async ({ slug }) => {
    const rootDir = getProjectRoot();
    const configPath = resolve(rootDir, "assistants", slug, "config.json");
    if (!existsSync(configPath)) return err(`Assistant "${slug}" not found`);
    if (!serverState.dashboard) return err("Dashboard not initialized");
    (serverState.dashboard as any).io?.emit("dashboard:assistantChanged", { assistant: slug });
    // Also update via action handler if available
    if (serverState.controller) {
      try {
        serverState.controller.handleDashboardAction("setAssistant", { assistant: slug });
      } catch { /* ignore */ }
    }
    return ok({ success: true, message: `Active assistant switched to "${slug}"` });
  });

  server.registerTool("update_assistant_config", {
    description: "Update an assistant's configuration (name, prompts, behavior, language, etc.)",
    inputSchema: {
      slug: z.string().describe("Assistant slug to update"),
      config: z.record(z.string(), z.unknown()).describe("Config fields to update (merged with existing config)"),
    },
  }, async ({ slug, config: updates }) => {
    const rootDir = getProjectRoot();
    const configPath = resolve(rootDir, "assistants", slug, "config.json");
    if (!existsSync(configPath)) return err(`Assistant "${slug}" not found`);
    const existing = JSON.parse(readFileSync(configPath, "utf-8"));
    const merged = { ...existing, ...updates };
    writeFileSync(configPath, JSON.stringify(merged, null, 2));
    return ok({ success: true, config: merged });
  });

  server.registerTool("create_contact_list", {
    description: "Create or update a contact list with phone numbers",
    inputSchema: {
      name: z.string().describe("Contact list name"),
      entries: z.array(z.object({
        phone: z.string().describe("Phone number"),
        name: z.string().optional().describe("Contact name"),
      })).describe("Array of contacts with phone and optional name"),
      id: z.string().optional().describe("Existing list ID to update (omit to create new)"),
    },
  }, async ({ name, entries, id }) => {
    const rootDir = getProjectRoot();
    const listsDir = resolve(rootDir, "contact-lists");
    if (!existsSync(listsDir)) mkdirSync(listsDir, { recursive: true });

    const listId = id || `${name.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${Date.now()}`;
    const filePath = join(listsDir, `${listId}.json`);

    let createdAt = new Date().toISOString();
    if (existsSync(filePath)) {
      try {
        const existing = JSON.parse(readFileSync(filePath, "utf-8"));
        if (existing.createdAt) createdAt = existing.createdAt;
      } catch { /* use new date */ }
    }

    const data = { id: listId, name: name.trim(), entries, createdAt, updatedAt: new Date().toISOString() };
    writeFileSync(filePath, JSON.stringify(data, null, 2));
    return ok({ success: true, id: listId, name: data.name, count: entries.length });
  });

  server.registerTool("delete_contact_list", {
    description: "Delete a contact list",
    annotations: { destructiveHint: true },
    inputSchema: {
      id: z.string().describe("Contact list ID to delete"),
    },
  }, async ({ id }) => {
    const rootDir = getProjectRoot();
    const filePath = resolve(rootDir, "contact-lists", `${id}.json`);
    if (!existsSync(filePath)) return err(`Contact list "${id}" not found`);
    unlinkSync(filePath);
    return ok({ success: true, message: `Contact list "${id}" deleted` });
  });

  server.registerTool("update_routing", {
    description: "Update incoming call routing rules (extension and caller ID pattern → assistant mappings)",
    inputSchema: {
      extensionRoutes: z.array(z.object({
        pattern: z.string().describe("Extension pattern (regex)"),
        assistant: z.string().describe("Assistant slug"),
      })).optional().describe("Extension-based routing rules"),
      callerIdRoutes: z.array(z.object({
        pattern: z.string().describe("Caller ID pattern (regex)"),
        assistant: z.string().describe("Assistant slug"),
      })).optional().describe("Caller ID-based routing rules"),
    },
  }, async ({ extensionRoutes, callerIdRoutes }) => {
    const rootDir = getProjectRoot();
    const routingPath = resolve(rootDir, "config", "routing.json");
    const dir = resolve(rootDir, "config");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const data = {
      extensionRoutes: extensionRoutes || [],
      callerIdRoutes: callerIdRoutes || [],
    };
    writeFileSync(routingPath, JSON.stringify(data, null, 2) + "\n");
    return ok({ success: true, message: "Routing rules updated" });
  });

  server.registerTool("reconnect_service", {
    description: "Reconnect a backend service (Asterisk ARI, transcription engine, or restart Parakeet)",
    inputSchema: {
      service: z.enum(["ari", "transcription", "parakeet"]).describe("Service to reconnect/restart"),
    },
  }, async ({ service }) => {
    if (!serverState.dashboard) return err("Dashboard not initialized");
    const dashboard = serverState.dashboard as any;
    try {
      if (service === "ari") {
        dashboard.io?.emit("dashboard:reconnectAri");
        if (serverState.controller) serverState.controller.handleDashboardAction("reconnectAri", {});
      } else if (service === "transcription") {
        if (serverState.controller) serverState.controller.handleDashboardAction("reconnectTranscription", {});
      } else if (service === "parakeet") {
        dashboard.io?.emit("dashboard:restartParakeet");
      }
      return ok({ success: true, message: `${service} reconnect/restart requested` });
    } catch (e: any) {
      return err(`Failed to reconnect ${service}: ${e.message}`);
    }
  });

  server.registerTool("hangup_call", {
    description: "Hang up an active phone call",
    annotations: { destructiveHint: true },
    inputSchema: {
      sessionId: z.string().describe("The session ID of the call to hang up"),
    },
  }, async ({ sessionId }) => {
    if (!serverState.controller) return err("Controller not initialized");
    try {
      serverState.controller.handleDashboardAction("hangup", { sessionId });
      return ok({ success: true, message: `Hangup requested for session ${sessionId}` });
    } catch (e: any) {
      return err(`Hangup failed: ${e.message}`);
    }
  });

  server.registerTool("transfer_call", {
    description: "Transfer an active call to another extension or SIP endpoint",
    annotations: { destructiveHint: true },
    inputSchema: {
      sessionId: z.string().describe("The session ID of the call to transfer"),
      endpoint: z.string().describe("Transfer destination (extension number, SIP URI, or trunk endpoint)"),
    },
  }, async ({ sessionId, endpoint }) => {
    if (!serverState.controller) return err("Controller not initialized");
    try {
      serverState.controller.handleDashboardAction("transfer", { sessionId, endpoint });
      return ok({ success: true, message: `Transfer requested: ${sessionId} → ${endpoint}` });
    } catch (e: any) {
      return err(`Transfer failed: ${e.message}`);
    }
  });

  server.registerTool("pause_campaign", {
    description: "Pause the currently running auto-dialer campaign",
  }, async () => {
    if (!serverState.autoDialer) return err("No active campaign");
    serverState.autoDialer.pause();
    return ok({ success: true, message: "Campaign paused" });
  });

  server.registerTool("resume_campaign", {
    description: "Resume a paused auto-dialer campaign",
  }, async () => {
    if (!serverState.autoDialer) return err("No active campaign");
    serverState.autoDialer.resume();
    return ok({ success: true, message: "Campaign resumed" });
  });

  server.registerTool("stop_campaign", {
    description: "Stop the active auto-dialer campaign completely",
    annotations: { destructiveHint: true },
  }, async () => {
    if (!serverState.autoDialer) return err("No active campaign");
    serverState.autoDialer.stop();
    return ok({ success: true, message: "Campaign stopped" });
  });
}

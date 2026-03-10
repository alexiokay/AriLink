/**
 * ToolExecutor — executes per-agent tools defined in tools.json / tools/*.ts
 *
 * Handler types:
 *   http     — fetch() GET/POST with template variable substitution
 *   webhook  — POST all args as JSON body to a URL
 *   transfer — harness.transferCall(extension)
 *   hangup   — harness.hangup()
 *   shell    — child_process.exec() with timeout, stdout as result
 *   module   — require(file).execute(args, ctx) — full Node.js escape hatch
 *
 * Template variables in url/headers/query/body/command:
 *   {{argName}}       — from tool call arguments
 *   {{config.key}}    — from assistant config.json
 *   {{env.KEY_NAME}}  — from process.env
 *
 * Module tools (escape hatch for external processes, DBs, etc.):
 *   Return "__transfer__:ext" to transfer the call
 *   Return "__hangup__" to end the call
 *   Otherwise return a string → injected into LLM history as tool result
 */

const { execFile } = require("child_process");
const path = require("path");

import type { AgentTool, ToolContext } from "../assistants/base/BrainTypes";
import type { IBrainHarness } from "../assistants/base/BrainTypes";

export class ToolExecutor {
  private tools: AgentTool[];
  private harness: IBrainHarness;
  private callerId: string;

  constructor(tools: AgentTool[], harness: IBrainHarness, callerId: string) {
    this.tools = tools;
    this.harness = harness;
    this.callerId = callerId;
  }

  /** OpenAI-format tool definitions to include in the LLM request */
  getDefinitions(): any[] {
    return this.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Execute a tool by name with parsed arguments.
   * Returns a string result to push into history as the tool message.
   * May throw — caller should catch and push an error result instead.
   */
  async execute(name: string, args: Record<string, any>): Promise<{ result: string; action?: "transfer" | "hangup"; extension?: string }> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      return { result: `Error: unknown tool "${name}"` };
    }

    const sid = this.harness.sessionId;
    console.log(`[ToolExecutor][Session ${sid}] Executing "${name}" args=${JSON.stringify(args)}`);

    try {
      switch (tool.handler.type) {
        case "http":
          return { result: await this.runHttp(tool.handler, args, tool) };

        case "webhook":
          return { result: await this.runWebhook(tool.handler, args) };

        case "transfer": {
          const ext = this.interpolate(tool.handler.extension, args, tool);
          await this.harness.transferCall(ext);
          return { result: "Call transferred to " + ext, action: "transfer", extension: ext };
        }

        case "hangup":
          await this.harness.hangup();
          return { result: "Call ended", action: "hangup" };

        case "shell":
          return { result: await this.runShell(tool.handler, args, tool) };

        case "module":
          return await this.runModule(tool.handler, args, tool);

        case "mcp":
          return { result: await this.runMcp(tool.handler, args) };

        default:
          return { result: `Error: unsupported handler type` };
      }
    } catch (err: any) {
      console.error(`[ToolExecutor][Session ${sid}] Tool "${name}" failed: ${err.message}`);
      return { result: `Error executing ${name}: ${err.message}` };
    }
  }

  // ── Private ──

  private async runHttp(handler: Extract<AgentTool["handler"], { type: "http" }>, args: Record<string, any>, tool: AgentTool): Promise<string> {
    const method = (handler.method || "GET").toUpperCase();
    let url = this.interpolate(handler.url, args, tool);

    if (this.isPrivateUrl(url)) {
      throw new Error(`SSRF blocked: URL resolves to a private or reserved address (${url})`);
    }

    // Build query string
    if (handler.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(handler.query)) {
        params.set(k, this.interpolate(v, args, tool));
      }
      url += (url.includes("?") ? "&" : "?") + params.toString();
    }

    // Build headers
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (handler.headers) {
      for (const [k, v] of Object.entries(handler.headers)) {
        headers[k] = this.interpolate(v, args, tool);
      }
    }

    // Build body
    let body: string | undefined;
    if (handler.body && method !== "GET") {
      const resolved: Record<string, any> = {};
      for (const [k, v] of Object.entries(handler.body)) {
        resolved[k] = typeof v === "string" ? this.interpolate(v, args, tool) : v;
      }
      body = JSON.stringify(resolved);
    } else if (method === "POST" && !handler.body) {
      body = JSON.stringify(args);
    }

    const timeout = handler.timeout || 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal });
      const text = await res.text();
      console.log(`[ToolExecutor] http ${method} ${url} → ${res.status}`);
      // Try to parse as JSON for a cleaner result, fall back to raw text
      try {
        const json = JSON.parse(text);
        return JSON.stringify(json);
      } catch {
        return text.slice(0, 2000); // cap at 2000 chars
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async runWebhook(handler: Extract<AgentTool["handler"], { type: "webhook" }>, args: Record<string, any>): Promise<string> {
    if (this.isPrivateUrl(handler.url)) {
      throw new Error(`SSRF blocked: URL resolves to a private or reserved address (${handler.url})`);
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (handler.headers) {
      for (const [k, v] of Object.entries(handler.headers)) {
        headers[k] = v;
      }
    }
    const timeout = handler.timeout || 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(handler.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...args, _callerId: this.callerId, _sessionId: this.harness.sessionId }),
        signal: controller.signal,
      });
      const text = await res.text();
      console.log(`[ToolExecutor] webhook POST ${handler.url} → ${res.status}`);
      return text.slice(0, 2000) || `OK (${res.status})`;
    } finally {
      clearTimeout(timer);
    }
  }

  private runShell(handler: Extract<AgentTool["handler"], { type: "shell" }>, args: Record<string, any>, tool: AgentTool): Promise<string> {
    // Use shell-safe interpolation: LLM arg values are single-quoted to prevent injection
    const command = this.interpolateShell(handler.command, args, tool);
    const timeout = handler.timeout || 10_000;
    console.log(`[ToolExecutor] shell: ${command}`);

    return new Promise((resolve) => {
      // Use shell:true for cross-platform compatibility
      const proc = require("child_process").exec(command, { timeout, shell: true }, (err: any, stdout: string, stderr: string) => {
        if (err) {
          resolve(`Error: ${err.message}${stderr ? "\n" + stderr.slice(0, 500) : ""}`);
        } else {
          resolve((stdout || "").slice(0, 2000));
        }
      });
    });
  }

  private async runModule(handler: Extract<AgentTool["handler"], { type: "module" }>, args: Record<string, any>, tool: AgentTool): Promise<{ result: string; action?: "transfer" | "hangup"; extension?: string }> {
    const assistantDir = tool._assistantDir || "";

    // Reject absolute paths — module files must be within the assistant directory
    if (path.isAbsolute(handler.file)) {
      return { result: `Error: module file path must be relative, not absolute` };
    }
    const filePath = path.resolve(assistantDir, handler.file);

    // Containment check — prevent path traversal (e.g. ../../core/TtsClient)
    const allowedBase = path.resolve(assistantDir);
    if (!filePath.startsWith(allowedBase + path.sep) && filePath !== allowedBase) {
      return { result: `Error: module file path escapes the assistant directory` };
    }

    console.log(`[ToolExecutor] module: ${filePath}`);
    const mod = require(filePath);
    if (typeof mod.execute !== "function") {
      return { result: `Error: ${filePath} does not export an execute() function` };
    }

    const ctx: ToolContext = {
      callerId: this.callerId,
      sessionId: this.harness.sessionId,
      config: this.harness.config,
      env: process.env,
    };

    const raw: string = await mod.execute(args, ctx);

    // Check for call-control signals from the module
    if (typeof raw === "string" && raw.startsWith("__transfer__:")) {
      const ext = raw.slice("__transfer__:".length).trim();
      await this.harness.transferCall(ext);
      return { result: `Call transferred to ${ext}`, action: "transfer", extension: ext };
    }
    if (raw === "__hangup__") {
      await this.harness.hangup();
      return { result: "Call ended", action: "hangup" };
    }

    return { result: typeof raw === "string" ? raw : JSON.stringify(raw) };
  }

  /**
   * Call an MCP tool via the streamable HTTP transport (JSON-RPC 2.0).
   * Supports the 2024-11-05 MCP spec: POST to serverUrl with tools/call method.
   */
  private async runMcp(handler: Extract<AgentTool["handler"], { type: "mcp" }>, args: Record<string, any>): Promise<string> {
    const timeout = handler.timeout || 15_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const reqBody = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: handler.toolName, arguments: args },
    };

    console.log(`[ToolExecutor] mcp POST ${handler.serverUrl} → ${handler.toolName}(${JSON.stringify(args)})`);

    try {
      const res = await fetch(handler.serverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify(reqBody),
        signal: controller.signal,
      });

      const text = await res.text();

      // Handle SSE response (some MCP servers stream results)
      // Use the LAST data: line — earlier ones may be progress events, not the final result
      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        const allMatches = [...text.matchAll(/^data: (.+)$/gm)];
        const lastMatch = allMatches[allMatches.length - 1];
        if (lastMatch) {
          const parsed = JSON.parse(lastMatch[1]);
          return this.extractMcpResult(parsed);
        }
        return text.slice(0, 2000);
      }

      const parsed = JSON.parse(text);
      if (parsed.error) {
        return `MCP error: ${parsed.error.message || JSON.stringify(parsed.error)}`;
      }
      return this.extractMcpResult(parsed);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Extract human-readable result from MCP tools/call response */
  private extractMcpResult(parsed: any): string {
    const result = parsed.result;
    if (!result) return JSON.stringify(parsed).slice(0, 2000);
    // MCP content array: [{ type: "text", text: "..." }, ...]
    if (Array.isArray(result.content)) {
      return result.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n")
        .slice(0, 2000) || JSON.stringify(result).slice(0, 2000);
    }
    return typeof result === "string" ? result : JSON.stringify(result).slice(0, 2000);
  }

  /**
   * Replace {{argName}}, {{config.key}}, {{env.KEY}} in a string.
   * Values are inserted verbatim — use interpolateShell for shell commands.
   */
  private interpolate(template: string, args: Record<string, any>, tool: AgentTool): string {
    const config = this.harness.config as any;
    return template.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
      expr = expr.trim();
      if (expr.startsWith("env.")) {
        return process.env[expr.slice(4)] ?? "";
      }
      if (expr.startsWith("config.")) {
        const key = expr.slice(7);
        return String(config?.[key] ?? config?.behavior?.[key] ?? "");
      }
      return String(args[expr] ?? "");
    });
  }

  /**
   * Shell-safe interpolation: each substituted value is single-quoted so
   * shell metacharacters in LLM-supplied arguments cannot escape the command.
   * e.g. {{phone}} = "+48;rm -rf /" → becomes '+48;rm -rf /' (safe literal)
   */
  /**
   * SSRF protection: returns true if the URL resolves to a private, loopback, or reserved
   * IP range that should never be reachable from a tool call.
   * Blocks: loopback (127.x, ::1), private (10.x, 172.16-31.x, 192.168.x),
   *         link-local / AWS metadata (169.254.x), CGNAT (100.64-127.x).
   * Set env ALLOW_PRIVATE_TOOL_URLS=true to bypass (local dev only).
   */
  private isPrivateUrl(url: string): boolean {
    if (process.env.ALLOW_PRIVATE_TOOL_URLS === "true") return false;

    let parsed: URL;
    try { parsed = new URL(url); } catch { return true; }

    const raw = parsed.hostname.toLowerCase();
    const host = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;

    // Loopback / unspecified hostnames
    if (["localhost", "::1", "0.0.0.0", ""].includes(host)) return true;

    // IPv4 private / reserved ranges
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
      if (a === 10) return true;                          // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
      if (a === 192 && b === 168) return true;            // 192.168.0.0/16
      if (a === 127) return true;                         // 127.0.0.0/8 loopback
      if (a === 169 && b === 254) return true;            // 169.254.0.0/16 link-local / AWS metadata
      if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
      if (a === 0) return true;                           // 0.0.0.0/8 "this" network
      return false;
    }

    // IPv6 private ranges
    if (host === "::1") return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // ULA fc00::/7
    if (host.startsWith("fe80")) return true;                        // link-local fe80::/10

    return false;
  }

  private interpolateShell(template: string, args: Record<string, any>, tool: AgentTool): string {
    const config = this.harness.config as any;
    const shellQuote = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
    return template.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
      expr = expr.trim();
      if (expr.startsWith("env.")) {
        return shellQuote(process.env[expr.slice(4)] ?? "");
      }
      if (expr.startsWith("config.")) {
        const key = expr.slice(7);
        return shellQuote(String(config?.[key] ?? config?.behavior?.[key] ?? ""));
      }
      return shellQuote(String(args[expr] ?? ""));
    });
  }
}

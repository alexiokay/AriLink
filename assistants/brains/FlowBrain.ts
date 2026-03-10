/**
 * FlowBrain — Declarative IVR flow engine
 *
 * Reads a flow.json state machine and executes it:
 *   message      → play audio / TTS, advance to next
 *   menu         → play audio / TTS, wait for DTMF, branch by key
 *   collect      → play audio / TTS, wait for voice, store, advance
 *   transfer     → transfer the call
 *   hangup       → play goodbye, hang up
 *   condition    → evaluate variable, branch true/false
 *   http_request → call external API, store result, advance
 *   set_variable → set a variable value, advance
 *
 * Zero LLM cost, instant responses, fully deterministic.
 */

const { AssistantState } = require("../base/AssistantTypes");

import type { IBrain, IBrainHarness } from "../base/BrainTypes";

// ── Flow definition types ──

interface FlowNode {
  type: "message" | "menu" | "collect" | "transfer" | "hangup" | "condition" | "http_request" | "set_variable" | "trigger";
  label?: string;
  audio?: string;      // sound file reference, e.g. "custom/welcome"
  text?: string;       // TTS fallback
  next?: string;       // target node ID (message, collect, http_request, set_variable)
  options?: Record<string, string>; // DTMF key → node ID (menu)
  timeout?: { seconds: number; retries: number; next: string }; // menu timeout
  extension?: string;  // transfer destination
  variable?: string;   // collect/condition/set_variable variable name
  value?: string;      // set_variable value
  position?: { x: number; y: number }; // canvas position (UI only)
  // condition fields
  operator?: "equals" | "not_equals" | "contains" | "not_empty" | "empty" | "gt" | "lt";
  compareValue?: string;
  trueNext?: string;   // condition: branch when true
  falseNext?: string;  // condition: branch when false
  // http_request fields
  method?: string;
  url?: string;
  headersJson?: string;
  bodyJson?: string;
  resultVariable?: string;
  errorNext?: string;  // http_request: branch on error
}

interface FlowDefinition {
  startNode: string;
  nodes: Record<string, FlowNode>;
}

class FlowBrain implements IBrain {
  private harness!: IBrainHarness;
  private flow!: FlowDefinition;
  private currentNode: string = "";
  private retryCount: number = 0;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private variables: Record<string, string> = {};

  init(harness: IBrainHarness): void {
    this.harness = harness;

    // Load flow definition from config (injected by AssistantFactory)
    const flowData = (harness.config as any)._flow;
    if (!flowData || !flowData.startNode || !flowData.nodes) {
      console.error(`[FlowBrain][Session ${harness.sessionId}] No valid flow.json found`);
      this.flow = { startNode: "", nodes: {} };
    } else {
      this.flow = flowData;
    }
  }

  async onCallStart(callerId: string, extension: string): Promise<void> {
    const sid = this.harness.sessionId;

    // Built-in variables — available as {{caller}}, {{extension}}, etc.
    this.variables["caller"] = callerId || "";
    this.variables["extension"] = extension || "";
    this.variables["timestamp"] = new Date().toISOString();
    this.variables["date"] = new Date().toLocaleDateString("en-US");
    this.variables["time"] = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    const nodeCount = Object.keys(this.flow.nodes).length;
    console.log(`[FlowBrain][Session ${sid}] Flow loaded: ${nodeCount} nodes, start="${this.flow.startNode}", caller="${callerId}"`);

    if (!this.flow.startNode || !this.flow.nodes[this.flow.startNode]) {
      console.error(`[FlowBrain][Session ${sid}] Invalid startNode: "${this.flow.startNode}"`);
      await this.speakOrPlay(undefined, "Sorry, this service is not configured yet. Goodbye.");
      await this.harness.hangup();
      return;
    }

    await this.transitionTo(this.flow.startNode);
  }

  async onDTMFInput(digit: string): Promise<void> {
    if (!this.harness.isState(AssistantState.LISTENING)) return;

    const node = this.flow.nodes[this.currentNode];
    if (!node || node.type !== "menu") return;

    const sid = this.harness.sessionId;
    console.log(`[FlowBrain][Session ${sid}] DTMF "${digit}" at node "${this.currentNode}"`);

    this.variables["digit"] = digit;
    this.clearTimeout();

    const target = node.options?.[digit];
    if (target && this.flow.nodes[target]) {
      this.retryCount = 0;
      await this.transitionTo(target);
    } else {
      // Invalid key — replay the menu prompt
      this.retryCount++;
      const maxRetries = node.timeout?.retries ?? 3;
      if (this.retryCount >= maxRetries) {
        const timeoutNext = node.timeout?.next;
        if (timeoutNext && this.flow.nodes[timeoutNext]) {
          await this.transitionTo(timeoutNext);
        } else {
          await this.harness.hangup();
        }
      } else {
        // Replay the prompt
        await this.playNode(node);
        this.startMenuTimeout(node);
      }
    }
  }

  async onTranscription(text: string, isFinal: boolean): Promise<void> {
    if (!isFinal || !this.harness.isState(AssistantState.LISTENING)) return;

    const node = this.flow.nodes[this.currentNode];
    if (!node || node.type !== "collect") return;

    const trimmed = text.trim();
    if (trimmed.length < 2) return; // ignore noise

    const sid = this.harness.sessionId;
    console.log(`[FlowBrain][Session ${sid}] Collected "${trimmed}" for variable "${node.variable || "input"}"`);

    this.variables[node.variable || "input"] = trimmed;

    if (node.next && this.flow.nodes[node.next]) {
      await this.transitionTo(node.next);
    }
  }

  async onCallEnd(): Promise<void> {
    this.clearTimeout();
    console.log(`[FlowBrain][Session ${this.harness.sessionId}] Call ended at node "${this.currentNode}"`);
  }

  destroy(): void {
    this.clearTimeout();
  }

  // ── Private ──

  private async transitionTo(nodeId: string): Promise<void> {
    this.currentNode = nodeId;
    const node = this.flow.nodes[nodeId];
    if (!node) return;

    const sid = this.harness.sessionId;
    console.log(`[FlowBrain][Session ${sid}] → "${nodeId}" (${node.type})`);

    switch (node.type) {
      case "trigger":
        // Pass-through — just advance to next node
        if (node.next && this.flow.nodes[node.next]) {
          await this.transitionTo(node.next);
        }
        break;

      case "message":
        this.harness.setState(AssistantState.SPEAKING);
        await this.playNode(node);
        if (node.next && this.flow.nodes[node.next]) {
          await this.transitionTo(node.next);
        }
        break;

      case "menu":
        this.harness.setState(AssistantState.SPEAKING);
        await this.playNode(node);
        this.harness.setState(AssistantState.LISTENING);
        this.startMenuTimeout(node);
        break;

      case "collect":
        this.harness.setState(AssistantState.SPEAKING);
        await this.playNode(node);
        this.harness.setState(AssistantState.LISTENING);
        break;

      case "transfer":
        this.harness.setState(AssistantState.TRANSFERRING, node.extension);
        await this.harness.transferCall(node.extension || "200");
        break;

      case "hangup":
        if (node.audio || node.text) {
          this.harness.setState(AssistantState.SPEAKING);
          await this.playNode(node);
        }
        await this.harness.hangup();
        break;

      case "condition": {
        const result = this.evaluateCondition(node);
        console.log(`[FlowBrain][Session ${sid}] Condition "${node.variable}" ${node.operator} "${node.compareValue}" → ${result}`);
        const target = result ? node.trueNext : node.falseNext;
        if (target && this.flow.nodes[target]) {
          await this.transitionTo(target);
        }
        break;
      }

      case "http_request": {
        this.harness.setState(AssistantState.PROCESSING);
        const { result: httpResult, error: httpError } = await this.executeHttpRequest(node);
        if (node.resultVariable) {
          this.variables[node.resultVariable] = httpResult;
        }
        if (httpError && node.errorNext && this.flow.nodes[node.errorNext]) {
          await this.transitionTo(node.errorNext);
        } else if (node.next && this.flow.nodes[node.next]) {
          await this.transitionTo(node.next);
        }
        break;
      }

      case "set_variable": {
        const varName = node.variable || "var";
        const varValue = this.interpolate(node.value || "");
        this.variables[varName] = varValue;
        console.log(`[FlowBrain][Session ${sid}] Set ${varName} = "${varValue}"`);
        if (node.next && this.flow.nodes[node.next]) {
          await this.transitionTo(node.next);
        }
        break;
      }
    }
  }

  private async playNode(node: FlowNode): Promise<void> {
    await this.speakOrPlay(node.audio, node.text);
  }

  private async speakOrPlay(audio?: string, text?: string): Promise<void> {
    if (audio) {
      try {
        await this.harness.playAudioWithFallback(audio, "beep");
        return;
      } catch {
        // Audio failed, fall through to TTS
      }
    }
    if (text) {
      try {
        await this.harness.speak(text);
      } catch (err: any) {
        if (err?.name === "BargeInError") return; // user interrupted — fine
        throw err;
      }
    }
  }

  private startMenuTimeout(node: FlowNode): void {
    this.clearTimeout();
    const seconds = node.timeout?.seconds ?? 10;
    this.timeoutTimer = setTimeout(async () => {
      if (!this.harness.isState(AssistantState.LISTENING)) return;

      this.retryCount++;
      const maxRetries = node.timeout?.retries ?? 3;

      if (this.retryCount >= maxRetries) {
        const timeoutNext = node.timeout?.next;
        if (timeoutNext && this.flow.nodes[timeoutNext]) {
          await this.transitionTo(timeoutNext);
        } else {
          await this.harness.hangup();
        }
      } else {
        // Replay prompt and restart timeout
        await this.playNode(node);
        this.harness.setState(AssistantState.LISTENING);
        this.startMenuTimeout(node);
      }
    }, seconds * 1000);
  }

  private clearTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /** Replace {{variable}} references with stored variable values */
  private interpolate(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => this.variables[key] || "");
  }

  /** Evaluate a condition node against stored variables */
  private evaluateCondition(node: FlowNode): boolean {
    const value = this.variables[node.variable || ""] || "";
    const compare = this.interpolate(node.compareValue || "");
    switch (node.operator) {
      case "equals": return value === compare;
      case "not_equals": return value !== compare;
      case "contains": return value.includes(compare);
      case "not_empty": return value.length > 0;
      case "empty": return value.length === 0;
      case "gt": return parseFloat(value) > parseFloat(compare);
      case "lt": return parseFloat(value) < parseFloat(compare);
      default: return value === compare;
    }
  }

  /** Execute an HTTP request node — returns { result, error } */
  private async executeHttpRequest(node: FlowNode): Promise<{ result: string; error: boolean }> {
    const sid = this.harness.sessionId;
    const url = this.interpolate(node.url || "");
    const method = (node.method || "GET").toUpperCase();

    if (!url) {
      console.warn(`[FlowBrain][Session ${sid}] HTTP node has no URL`);
      return { result: "", error: true };
    }

    console.log(`[FlowBrain][Session ${sid}] HTTP ${method} ${url}`);

    const opts: RequestInit = { method };
    const timeout = 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    opts.signal = controller.signal;

    // Parse headers
    if (node.headersJson) {
      try {
        const h = JSON.parse(this.interpolate(node.headersJson));
        opts.headers = h;
      } catch { /* ignore invalid headers */ }
    }

    // Parse body for non-GET
    if (method !== "GET" && node.bodyJson) {
      try {
        opts.body = this.interpolate(node.bodyJson);
        opts.headers = { "Content-Type": "application/json", ...(opts.headers as any || {}) };
      } catch { /* ignore */ }
    }

    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      const truncated = text.length > 2000 ? text.slice(0, 2000) : text;
      console.log(`[FlowBrain][Session ${sid}] HTTP ${res.status} → ${truncated.length} chars`);
      // Treat 4xx/5xx as errors (follow error path if available)
      return { result: truncated, error: res.status >= 400 };
    } catch (err: any) {
      const msg = err.name === "AbortError" ? "timeout" : err.message;
      console.error(`[FlowBrain][Session ${sid}] HTTP error: ${msg}`);
      return { result: "", error: true };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports.FlowBrain = FlowBrain;

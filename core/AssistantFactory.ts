const path = require("path");
const fs = require("fs");

import type { IAssistant, AssistantConfig } from "../assistants/base/AssistantTypes";
import type { PromptLayers } from "../assistants/base/BrainTypes";

/**
 * Read prompt layers (.md files) from an assistant's directory.
 * Returns null values for layers that don't have a file yet.
 */
function readLayers(assistantDir: string): PromptLayers {
  const read = (file: string): string | null => {
    const p = path.join(assistantDir, file);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
  };

  const layers: PromptLayers = {
    systemPrompt: read("system-prompt.md"),
    guardrails: read("guardrails.md"),
    knowledge: [],
    tools: [],
  };

  const knowledgeDir = path.join(assistantDir, "knowledge");
  if (fs.existsSync(knowledgeDir) && fs.statSync(knowledgeDir).isDirectory()) {
    const files: string[] = fs.readdirSync(knowledgeDir);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(knowledgeDir, f), "utf-8");
      layers.knowledge.push({ name: f.replace(/\.md$/, ""), content });
    }
  }

  // Load tools from tools.json (declarative: http/webhook/transfer/hangup/shell/module)
  const toolsJsonPath = path.join(assistantDir, "tools.json");
  if (fs.existsSync(toolsJsonPath)) {
    try {
      const toolDefs: any[] = JSON.parse(fs.readFileSync(toolsJsonPath, "utf-8"));
      for (const t of toolDefs) {
        if (t.name && t.description && t.handler) {
          layers.tools.push({ ...t, _assistantDir: assistantDir });
        }
      }
    } catch (err: any) {
      console.warn(`[AssistantFactory] Failed to parse tools.json in ${assistantDir}: ${err.message}`);
    }
  }

  // Auto-discover module tools from tools/*.ts that export a `definition`
  const toolsModDir = path.join(assistantDir, "tools");
  if (fs.existsSync(toolsModDir) && fs.statSync(toolsModDir).isDirectory()) {
    const files: string[] = fs.readdirSync(toolsModDir);
    for (const f of files) {
      if ((!f.endsWith(".ts") && !f.endsWith(".js")) || f.endsWith(".d.ts")) continue;
      const modPath = path.join(toolsModDir, f);
      try {
        const mod = require(modPath);
        if (mod.definition && mod.definition.name) {
          // Only add if not already declared in tools.json
          const alreadyDeclared = layers.tools.some((t) => t.name === mod.definition.name);
          if (!alreadyDeclared) {
            layers.tools.push({
              ...mod.definition,
              handler: { type: "module", file: modPath },
              _assistantDir: assistantDir,
            });
          }
        }
      } catch (err: any) {
        console.warn(`[AssistantFactory] Failed to load tool module ${modPath}: ${err.message}`);
      }
    }
  }

  if (layers.tools.length > 0) {
    console.log(`[AssistantFactory] Loaded ${layers.tools.length} tools from ${path.basename(assistantDir)}: ${layers.tools.map((t) => t.name).join(", ")}`);
  }

  return layers;
}

// Routing config: maps extensions/callerIDs to assistant types
interface RoutingRule {
  pattern: string;  // regex pattern or exact match
  assistant: string; // assistant slug (folder name)
}
interface RoutingConfig {
  extensionRoutes?: RoutingRule[];
  callerIdRoutes?: RoutingRule[];
}

let routingConfig: RoutingConfig | null = null;

function loadRoutingConfig(): RoutingConfig {
  if (routingConfig) return routingConfig;

  const configPath = path.resolve(__dirname, "../config/routing.json");
  if (fs.existsSync(configPath)) {
    try {
      routingConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      console.log(`[AssistantFactory] Loaded routing config from ${configPath}`);
    } catch (err: any) {
      console.warn(`[AssistantFactory] Failed to parse routing.json: ${err.message}`);
      routingConfig = {};
    }
  } else {
    routingConfig = {};
  }
  return routingConfig!;
}

function matchRoute(value: string, rules: RoutingRule[]): string | null {
  for (const rule of rules) {
    try {
      if (new RegExp(`^${rule.pattern}$`).test(value)) {
        return rule.assistant;
      }
    } catch {
      // Invalid regex — try exact match
      if (value === rule.pattern) return rule.assistant;
    }
  }
  return null;
}

/**
 * AssistantFactory
 *
 * Dynamically discovers assistants by scanning the assistants/ directory.
 * Each subfolder with a config.json and an *Assistant.ts file is registered.
 *
 * To add a new assistant, create a new folder under assistants/ with:
 * - config.json (with name, mode, prompts, behavior)
 * - YourAssistant.ts (exporting a class named YourAssistant)
 */

// Registry: slug -> { modulePath, exportName } (for classic assistants)
let registry: Record<string, { modulePath: string; exportName: string }> | null = null;
// Cache of loaded constructors (both assistant classes and brain classes)
const assistantCache: Record<string, any> = {};
// Brain registry: brainName -> { modulePath, exportName }
const brainRegistry: Record<string, { modulePath: string; exportName: string }> = {};

function buildRegistry(): Record<string, { modulePath: string; exportName: string }> {
  const assistantsDir = path.resolve(__dirname, "../assistants");
  const entries = fs.readdirSync(assistantsDir);
  const reg: Record<string, { modulePath: string; exportName: string }> = {};

  for (const entry of entries) {
    if (entry === "base" || entry === "brains") continue;
    const dirPath = path.join(assistantsDir, entry);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    // Find the *Assistant.ts (or .js) file in this directory
    const files = fs.readdirSync(dirPath);
    const assistantFile = files.find((f: string) =>
      (f.endsWith("Assistant.ts") || f.endsWith("Assistant.js")) && !f.endsWith(".d.ts")
    );
    if (!assistantFile) continue;

    // Derive export name from filename: "IvrTransferAssistant.ts" -> "IvrTransferAssistant"
    const exportName = assistantFile.replace(/\.(ts|js)$/, "");
    const modulePath = path.join(dirPath, assistantFile);

    reg[entry] = { modulePath, exportName };
  }

  // Also discover brains from assistants/brains/
  const brainsDir = path.join(assistantsDir, "brains");
  if (fs.existsSync(brainsDir) && fs.statSync(brainsDir).isDirectory()) {
    const brainFiles = fs.readdirSync(brainsDir);
    for (const f of brainFiles) {
      if (!f.endsWith("Brain.ts") && !f.endsWith("Brain.js")) continue;
      if (f.endsWith(".d.ts")) continue;

      const exportName = f.replace(/\.(ts|js)$/, "");
      // Derive brain slug: "IvrTransferBrain" -> "ivr-transfer"
      const slug = exportName
        .replace(/Brain$/, "")
        .replace(/([a-z])([A-Z])/g, "$1-$2")
        .toLowerCase();

      brainRegistry[slug] = {
        modulePath: path.join(brainsDir, f),
        exportName,
      };
    }
    if (Object.keys(brainRegistry).length > 0) {
      console.log(`[AssistantFactory] Discovered ${Object.keys(brainRegistry).length} brains: ${Object.keys(brainRegistry).join(", ")}`);
    }
  }

  console.log(`[AssistantFactory] Discovered ${Object.keys(reg).length} assistants: ${Object.keys(reg).join(", ")}`);
  return reg;
}

function getAssistantClass(type: string): any {
  if (!registry) {
    registry = buildRegistry();
  }

  if (assistantCache[type]) {
    return assistantCache[type];
  }

  const entry = registry[type];
  if (!entry) {
    const available = Object.keys(registry).join(", ");
    throw new Error(`[AssistantFactory] Unknown assistant type: "${type}". Available: ${available}`);
  }

  const mod = require(entry.modulePath);
  const Constructor = mod[entry.exportName];
  if (!Constructor) {
    throw new Error(`[AssistantFactory] Module ${entry.modulePath} does not export "${entry.exportName}"`);
  }

  assistantCache[type] = Constructor;
  return Constructor;
}

class AssistantFactory {
  /**
   * Read flow.json from an assistant directory.
   * Returns parsed FlowDefinition or null if not found.
   */
  static readFlow(assistantDir: string): any {
    const flowPath = path.join(assistantDir, "flow.json");
    if (!fs.existsSync(flowPath)) return null;
    try {
      const raw = fs.readFileSync(flowPath, "utf-8");
      const flow = JSON.parse(raw);
      if (flow.startNode && flow.nodes) return flow;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Create assistant by explicit type name (slug matches folder name).
   *
   * If the assistant's config.json has a "brain" field, creates a BrainHarness
   * with the specified brain instead of a custom assistant class.
   * This allows config-driven brain selection without custom assistant code.
   */
  static createByType(
    type: string,
    client: any,
    sessionId: string,
    contacts?: any
  ): IAssistant {
    const slug = type.toLowerCase();

    // Ensure registry + brainRegistry are built before checking
    if (!registry) {
      registry = buildRegistry();
    }

    // Check if this assistant type has a config.json with a "brain" field
    const assistantsDir = path.resolve(__dirname, "../assistants");
    const configPath = path.join(assistantsDir, slug, "config.json");

    if (fs.existsSync(configPath)) {
      try {
        const config: AssistantConfig & { brain?: string; _flow?: any } = JSON.parse(
          fs.readFileSync(configPath, "utf-8")
        );

        if (config.brain && brainRegistry[config.brain]) {
          const assistantDir = path.join(assistantsDir, slug);
          const layers = readLayers(assistantDir);

          // For flow brains, inject the flow definition into config
          if (config.brain === "flow") {
            const flowData = AssistantFactory.readFlow(assistantDir);
            if (flowData) {
              config._flow = flowData;
            }
          }

          return AssistantFactory.createWithBrain(config, config.brain, client, sessionId, contacts, layers);
        }
      } catch {
        // Fall through to classic assistant creation
      }
    }

    // Classic: load the *Assistant.ts class directly
    const AssistantClass = getAssistantClass(slug);
    return new AssistantClass(client, sessionId, contacts);
  }

  /**
   * Create an assistant using the BrainHarness + a named brain.
   * This is the pluggable brain architecture.
   */
  static createWithBrain(
    config: AssistantConfig,
    brainName: string,
    client: any,
    sessionId: string,
    contacts?: any,
    layers?: PromptLayers
  ): IAssistant {
    const brainEntry = brainRegistry[brainName];
    if (!brainEntry) {
      const available = Object.keys(brainRegistry).join(", ");
      throw new Error(`[AssistantFactory] Unknown brain: "${brainName}". Available: ${available}`);
    }

    // Load brain class
    const brainCacheKey = `brain:${brainName}`;
    if (!assistantCache[brainCacheKey]) {
      const mod = require(brainEntry.modulePath);
      assistantCache[brainCacheKey] = mod[brainEntry.exportName];
    }
    const BrainClass = assistantCache[brainCacheKey];

    // Load BrainHarness
    if (!assistantCache["__BrainHarness"]) {
      const { BrainHarness } = require("../assistants/base/BrainHarness");
      assistantCache["__BrainHarness"] = BrainHarness;
    }
    const BrainHarness = assistantCache["__BrainHarness"];

    const brain = new BrainClass();
    console.log(`[AssistantFactory] Creating BrainHarness with brain: ${brainName}`);
    return new BrainHarness(config, client, sessionId, contacts, brain, layers);
  }

  /**
   * Create assistant based on extension routing.
   * Reads rules from config/routing.json — extensionRoutes array.
   * Falls back to defaultAssistant or "ivr-transfer".
   */
  static createFromExtension(
    extension: string,
    client: any,
    sessionId: string,
    contacts?: any
  ): IAssistant {
    const config = loadRoutingConfig();
    if (config.extensionRoutes?.length) {
      const matched = matchRoute(extension, config.extensionRoutes);
      if (matched) {
        console.log(`[AssistantFactory] Extension ${extension} matched route → ${matched}`);
        return AssistantFactory.createByType(matched, client, sessionId, contacts);
      }
    }
    const fallback = process.env.DEFAULT_ASSISTANT || "ivr-transfer";
    return AssistantFactory.createByType(fallback, client, sessionId, contacts);
  }

  /**
   * Create assistant based on caller ID.
   * Reads rules from config/routing.json — callerIdRoutes array.
   * Falls back to DEFAULT_ASSISTANT env var or "ivr-transfer".
   */
  static createFromCallerId(
    callerId: string,
    client: any,
    sessionId: string,
    contacts?: any
  ): IAssistant {
    const config = loadRoutingConfig();
    if (config.callerIdRoutes?.length) {
      const matched = matchRoute(callerId, config.callerIdRoutes);
      if (matched) {
        console.log(`[AssistantFactory] CallerID ${callerId} matched route → ${matched}`);
        return AssistantFactory.createByType(matched, client, sessionId, contacts);
      }
    }
    const fallback = process.env.DEFAULT_ASSISTANT || "ivr-transfer";
    return AssistantFactory.createByType(fallback, client, sessionId, contacts);
  }

  /**
   * Create assistant using the full routing chain:
   *   1. DID/extension routes (config/routing.json extensionRoutes)
   *   2. CallerID routes (config/routing.json callerIdRoutes)
   *   3. DEFAULT_ASSISTANT env var fallback
   *   4. "ivr-transfer" hardcoded fallback
   *
   * This is the primary routing method for multi-tenant setups where
   * different DIDs map to different assistants/clients.
   */
  static createFromRouting(
    extension: string,
    callerId: string,
    client: any,
    sessionId: string,
    contacts?: any
  ): IAssistant {
    const config = loadRoutingConfig();
    const fallback = process.env.DEFAULT_ASSISTANT || "ivr-transfer";

    // 1. Try extension/DID-based routing
    if (config.extensionRoutes?.length) {
      const matched = matchRoute(extension, config.extensionRoutes);
      if (matched) {
        console.log(`[AssistantFactory] DID ${extension} matched route → ${matched}`);
        return AssistantFactory.createByType(matched, client, sessionId, contacts);
      }
    }

    // 2. Try callerID-based routing
    if (config.callerIdRoutes?.length) {
      const matched = matchRoute(callerId, config.callerIdRoutes);
      if (matched) {
        console.log(`[AssistantFactory] CallerID ${callerId} matched route → ${matched}`);
        return AssistantFactory.createByType(matched, client, sessionId, contacts);
      }
    }

    // 3. Fallback
    return AssistantFactory.createByType(fallback, client, sessionId, contacts);
  }

  /**
   * Reload routing config from disk (e.g., after editing via dashboard).
   */
  static reloadRouting(): void {
    routingConfig = null;
    loadRoutingConfig();
  }

  /**
   * Get current routing config (for dashboard API).
   */
  static getRoutingConfig(): RoutingConfig {
    return loadRoutingConfig();
  }

  /**
   * Get list of available assistant slugs.
   */
  static getAvailableAssistants(): string[] {
    if (!registry) registry = buildRegistry();
    return Object.keys(registry);
  }

  /**
   * Get list of available brain slugs.
   */
  static getAvailableBrains(): string[] {
    if (!registry) registry = buildRegistry();
    return Object.keys(brainRegistry);
  }
}

module.exports.AssistantFactory = AssistantFactory;

const path = require("path");
const fs = require("fs");

import type { IAssistant } from "../assistants/base/AssistantTypes";

// Routing config: maps extensions/callerIDs to assistant types
interface RoutingRule {
  pattern: string;  // regex pattern or exact match
  assistant: string; // assistant slug (folder name)
}
interface RoutingConfig {
  extensionRoutes?: RoutingRule[];
  callerIdRoutes?: RoutingRule[];
  defaultAssistant?: string;
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

// Registry: slug -> { modulePath, exportName }
let registry: Record<string, { modulePath: string; exportName: string }> | null = null;
// Cache of loaded constructors
const assistantCache: Record<string, any> = {};

function buildRegistry(): Record<string, { modulePath: string; exportName: string }> {
  const assistantsDir = path.resolve(__dirname, "../assistants");
  const entries = fs.readdirSync(assistantsDir);
  const reg: Record<string, { modulePath: string; exportName: string }> = {};

  for (const entry of entries) {
    if (entry === "base") continue;
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
   * Create assistant by explicit type name (slug matches folder name)
   */
  static createByType(
    type: string,
    client: any,
    sessionId: string,
    contacts?: any
  ): IAssistant {
    const AssistantClass = getAssistantClass(type.toLowerCase());
    return new AssistantClass(client, sessionId, contacts);
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
    const fallback = config.defaultAssistant || "ivr-transfer";
    return AssistantFactory.createByType(fallback, client, sessionId, contacts);
  }

  /**
   * Create assistant based on caller ID.
   * Reads rules from config/routing.json — callerIdRoutes array.
   * Falls back to defaultAssistant or "ivr-transfer".
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
    const fallback = config.defaultAssistant || "ivr-transfer";
    return AssistantFactory.createByType(fallback, client, sessionId, contacts);
  }

  /**
   * Reload routing config from disk (e.g., after editing via dashboard).
   */
  static reloadRouting(): void {
    routingConfig = null;
    loadRoutingConfig();
  }
}

module.exports.AssistantFactory = AssistantFactory;

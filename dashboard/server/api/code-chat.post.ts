import { streamText, UIMessage, convertToModelMessages, tool, stepCountIs } from "ai";
import { createMistral } from "@ai-sdk/mistral";
import { z } from "zod";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { resolve, join, relative, normalize } from "path";

export default defineEventHandler(async (event) => {
  if (!process.env.MISTRAL_API_KEY) {
    throw createError({ statusCode: 503, message: "MISTRAL_API_KEY not configured" });
  }

  const mistral = createMistral({
    apiKey: process.env.MISTRAL_API_KEY,
  });

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const assistantsDir = resolve(rootDir, "assistants");

  const { messages, code, fileName, slug, model: modelId } = await readBody(event) as {
    messages: UIMessage[];
    code?: string;
    fileName?: string;
    slug?: string;
    model?: string;
  };

  const ALLOWED_MODELS = ["codestral-latest", "mistral-large-latest", "mistral-small-latest"];
  const resolvedModel = ALLOWED_MODELS.includes(modelId || "") ? modelId! : "codestral-latest";

  const systemPrompt = `You are an AI coding assistant for AriLink — an Asterisk ARI telephony platform.

SCOPE & PERMISSIONS:
- You are helping edit the assistant "${slug || "unknown"}" (file: ${fileName || "unknown"}).
- You can READ any file in the project (code, docs, README, core/, etc.) using readProjectFile and listProjectFiles.
- You can ONLY suggest code changes to the currently edited assistant. Never suggest edits to BaseAssistant, core files, or other assistants.
- The user will apply your code suggestions manually via the "Apply" button.
- USE YOUR TOOLS. When the user asks about a file, read it. Don't say you can't access it.

ARCHITECTURE:
- Each assistant extends BaseAssistant and handles call flows via Asterisk ARI.
- Assistants live in assistants/<slug>/ with a config.json and *Assistant.ts file.
- BaseAssistant provides: this.client (ARI), this.config, this.state, channel management, transcription hooks.
- AssistantTypes.ts defines TypeScript interfaces (AssistantConfig, AssistantState, etc.)
- Core logic is in core/ (AriControllerServer.ts, AutoDialer.ts, DashboardServer.ts, etc.)
- Documentation is in docs/

STYLE:
- Be concise and focused. Short explanations, complete code blocks.
- When suggesting code changes, use \`\`\`typescript code blocks.
- Provide the FULL file content when making changes (not patches/diffs).

${code ? `CURRENT CODE (${fileName}):\n\`\`\`typescript\n${code}\n\`\`\`` : ""}`;

  const result = streamText({
    model: mistral(resolvedModel),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    maxTokens: 4096,
    temperature: 0.3,
    stopWhen: stepCountIs(5),
    tools: {
      listAssistants: tool({
        description: "List all available assistants with their names and modes",
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const dirs = readdirSync(assistantsDir, { withFileTypes: true })
              .filter(d => d.isDirectory() && d.name !== "base");
            const list = dirs.map(d => {
              const configPath = join(assistantsDir, d.name, "config.json");
              let cfg: any = {};
              try { cfg = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
              return { slug: d.name, name: cfg.name || d.name, mode: cfg.mode || "incoming" };
            });
            return { assistants: list };
          } catch { return { assistants: [] }; }
        },
      }),

      readAssistantCode: tool({
        description: "Read the TypeScript source code of any assistant (read-only, for reference)",
        inputSchema: z.object({
          slug: z.string().describe("The assistant slug (e.g., 'ivr-transfer', 'direct-dial')"),
        }),
        execute: async ({ slug: targetSlug }) => {
          try {
            const dir = join(assistantsDir, targetSlug);
            if (!existsSync(dir)) return { error: `Assistant '${targetSlug}' not found` };

            const files = readdirSync(dir).filter(f => f.endsWith("Assistant.ts"));
            if (!files.length) return { error: "No *Assistant.ts file found" };

            const code = readFileSync(join(dir, files[0]), "utf-8");
            return { fileName: files[0], code };
          } catch (e: any) { return { error: e.message }; }
        },
      }),

      readAssistantConfig: tool({
        description: "Read the config.json of any assistant (read-only)",
        inputSchema: z.object({
          slug: z.string().describe("The assistant slug"),
        }),
        execute: async ({ slug: targetSlug }) => {
          try {
            const configPath = join(assistantsDir, targetSlug, "config.json");
            if (!existsSync(configPath)) return { error: `Config not found for '${targetSlug}'` };
            const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
            return { config: cfg };
          } catch (e: any) { return { error: e.message }; }
        },
      }),

      readBaseAssistant: tool({
        description: "Read the BaseAssistant.ts source code (the base class all assistants extend)",
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const basePath = join(assistantsDir, "base", "BaseAssistant.ts");
            if (!existsSync(basePath)) return { error: "BaseAssistant.ts not found" };
            return { code: readFileSync(basePath, "utf-8") };
          } catch (e: any) { return { error: e.message }; }
        },
      }),

      readAssistantTypes: tool({
        description: "Read the AssistantTypes.ts file with TypeScript interfaces and types",
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const typesPath = join(assistantsDir, "base", "AssistantTypes.ts");
            if (!existsSync(typesPath)) return { error: "AssistantTypes.ts not found" };
            return { code: readFileSync(typesPath, "utf-8") };
          } catch (e: any) { return { error: e.message }; }
        },
      }),

      listProjectFiles: tool({
        description: "List files and directories at a given path in the project. Use to explore the project structure (e.g. 'core/', 'docs/', root '')",
        inputSchema: z.object({
          path: z.string().describe("Relative path from project root (e.g. '', 'core', 'docs', 'assistants/ivr-transfer')"),
        }),
        execute: async ({ path: relPath }) => {
          try {
            const target = resolve(rootDir, normalize(relPath || ""));
            // Security: stay within project root
            if (!target.startsWith(rootDir)) return { error: "Path outside project" };
            if (!existsSync(target)) return { error: `Path '${relPath}' not found` };

            const stat = statSync(target);
            if (!stat.isDirectory()) return { error: "Not a directory, use readProjectFile instead" };

            const entries = readdirSync(target, { withFileTypes: true })
              .filter(e => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== ".output")
              .map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
            return { path: relPath || "/", entries };
          } catch (e: any) { return { error: e.message }; }
        },
      }),

      readProjectFile: tool({
        description: "Read any file in the project (read-only). Use for README, docs, core/ files, package.json, etc.",
        inputSchema: z.object({
          path: z.string().describe("Relative path from project root (e.g. 'README.md', 'core/AriControllerServer.ts', 'docs/3CX-INTEGRATION.md')"),
        }),
        execute: async ({ path: relPath }) => {
          try {
            const target = resolve(rootDir, normalize(relPath));
            // Security: stay within project, block secrets
            if (!target.startsWith(rootDir)) return { error: "Path outside project" };
            const base = relative(rootDir, target);
            if (base === ".env" || base.includes(".env.")) return { error: "Cannot read .env files (contains secrets)" };
            if (!existsSync(target)) return { error: `File '${relPath}' not found` };

            const stat = statSync(target);
            if (stat.isDirectory()) return { error: "Path is a directory, use listProjectFiles instead" };
            if (stat.size > 100_000) return { error: "File too large (>100KB)" };

            return { path: relPath, content: readFileSync(target, "utf-8") };
          } catch (e: any) { return { error: e.message }; }
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
});

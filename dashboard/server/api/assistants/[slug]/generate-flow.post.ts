import { generateText } from "ai";
import { createMistral } from "@ai-sdk/mistral";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";

export default defineEventHandler(async (event) => {
  if (!process.env.MISTRAL_API_KEY) {
    throw createError({ statusCode: 503, message: "MISTRAL_API_KEY not configured" });
  }

  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || slug.includes("..")) {
    throw createError({ statusCode: 400, message: "Invalid slug" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const assistantDir = resolve(rootDir, "assistants", slug);

  if (!existsSync(assistantDir)) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  // Read assistant code
  const files = readdirSync(assistantDir);
  const codeFile = files.find((f) => f.endsWith("Assistant.ts"));
  const configFile = resolve(assistantDir, "config.json");

  let code = "";
  let configJson = "";

  if (codeFile) {
    code = readFileSync(resolve(assistantDir, codeFile), "utf-8");
  }
  if (existsSync(configFile)) {
    configJson = readFileSync(configFile, "utf-8");
  }

  if (!code) {
    throw createError({ statusCode: 400, message: "No assistant code found" });
  }

  const mistral = createMistral({ apiKey: process.env.MISTRAL_API_KEY });

  const result = await generateText({
    model: mistral("mistral-small-latest"),
    maxTokens: 1024,
    temperature: 0.2,
    prompt: `Analyze this Asterisk ARI assistant code and generate a Mermaid flowchart diagram showing its call flow.

RULES:
- Use "flowchart TD" (top-down direction)
- Use rounded nodes for start/end: ([text])
- Use trapezoid for audio playback: [/Play prompt_name/]
- Use diamond for decisions: {Question?}
- Use rectangle for actions: [Action]
- Label edges with conditions: -->|condition|
- Keep it concise but accurate — show ALL branches and decision points
- Include retry loops, timeouts, and error paths if they exist
- Output ONLY the raw Mermaid diagram code, no markdown fences, no explanation

CONFIG:
${configJson}

CODE:
${code}`,
  });

  const flow = result.text.trim()
    .replace(/^```mermaid\s*/i, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/, "")
    .trim();

  return { flow };
});

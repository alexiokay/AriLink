import { existsSync, writeFileSync } from "fs";
import { resolve, join } from "path";

const VALID_NODE_TYPES = ["message", "menu", "collect", "transfer", "hangup", "condition", "http_request", "set_variable", "trigger"];

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  const config = useRuntimeConfig();
  const rootDir = config.projectRoot as string;
  const assistantDir = resolve(rootDir, "assistants", slug);

  if (!existsSync(assistantDir)) {
    throw createError({ statusCode: 404, message: `Assistant '${slug}' not found` });
  }

  const body = await readBody(event);
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, message: "Request body must be a JSON object" });
  }

  const { startNode, nodes } = body;

  // Validate structure
  if (typeof startNode !== "string") {
    throw createError({ statusCode: 400, message: "startNode must be a string" });
  }
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) {
    throw createError({ statusCode: 400, message: "nodes must be an object" });
  }

  // Validate each node
  for (const [id, node] of Object.entries(nodes) as [string, any][]) {
    if (!node.type || !VALID_NODE_TYPES.includes(node.type)) {
      throw createError({ statusCode: 400, message: `Node "${id}" has invalid type: "${node.type}"` });
    }
  }

  // Validate startNode references an existing node (allow empty for blank flows)
  if (startNode && !nodes[startNode]) {
    throw createError({ statusCode: 400, message: `startNode "${startNode}" not found in nodes` });
  }

  const flowPath = join(assistantDir, "flow.json");
  writeFileSync(flowPath, JSON.stringify(body, null, 2), "utf-8");

  return { success: true, slug, nodeCount: Object.keys(nodes).length };
});

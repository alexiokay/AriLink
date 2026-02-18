// Toggle MCP server on/off at runtime
// POST /api/mcp-toggle { enabled: true/false }

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const enabled = body?.enabled;

  if (typeof enabled !== "boolean") {
    throw createError({ statusCode: 400, message: "Body must contain { enabled: boolean }" });
  }

  setMcpEnabled(enabled);
  return { mcpEnabled: enabled };
});

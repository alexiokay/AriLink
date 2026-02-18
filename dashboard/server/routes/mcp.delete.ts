// MCP Streamable HTTP — DELETE handler
// Terminates a client session and cleans up resources

export default defineEventHandler(async (event) => {
  if (!mcpEnabled) {
    throw createError({ statusCode: 503, message: "MCP server is disabled" });
  }

  const sessionId = getHeader(event, "mcp-session-id");
  if (!sessionId) {
    throw createError({ statusCode: 400, message: "mcp-session-id header required" });
  }

  const session = getMcpSession(sessionId);
  if (!session) {
    throw createError({ statusCode: 404, message: "MCP session not found" });
  }

  await session.transport.handleRequest(event.node.req, event.node.res);
  event._handled = true;
});

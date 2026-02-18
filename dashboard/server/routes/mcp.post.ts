// MCP Streamable HTTP — POST handler
// Handles JSON-RPC messages: initialization (new session) and tool calls (existing session)

export default defineEventHandler(async (event) => {
  if (!mcpEnabled) {
    throw createError({ statusCode: 503, message: "MCP server is disabled" });
  }

  const sessionId = getHeader(event, "mcp-session-id");
  const body = await readBody(event);

  let session;
  if (sessionId) {
    session = getMcpSession(sessionId);
    if (!session) {
      throw createError({ statusCode: 404, message: "MCP session not found" });
    }
  } else {
    // No session ID = initialization request → create new session
    session = await createMcpSession();
  }

  await session.transport.handleRequest(event.node.req, event.node.res, body);
  event._handled = true;
});

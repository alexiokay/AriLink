// Get MCP server status
// GET /api/mcp-status

export default defineEventHandler(() => {
  return { mcpEnabled };
});

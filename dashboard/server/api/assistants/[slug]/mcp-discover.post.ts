/**
 * POST /api/assistants/[slug]/mcp-discover
 * body: { url: string }
 *
 * Proxies a tools/list JSON-RPC call to the given MCP server from the server side
 * (avoids CORS issues when called directly from the browser).
 * Returns the list of tools exposed by the server.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug || slug === "base" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) {
    throw createError({ statusCode: 400, message: "Invalid assistant slug" });
  }

  const body = await readBody(event);
  const url: string = body?.url?.trim() ?? "";

  if (!url) {
    throw createError({ statusCode: 400, message: "url is required" });
  }

  // Validate scheme
  let parsed: URL;
  try { parsed = new URL(url); } catch {
    throw createError({ statusCode: 400, message: `Invalid URL: ${url}` });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createError({ statusCode: 400, message: "MCP server URL must use http or https" });
  }

  // Call tools/list on the MCP server
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: controller.signal,
    });

    const text = await res.text();
    let rpcResult: any;

    // Handle SSE response — use last data: line (earlier ones may be progress events)
    if (res.headers.get("content-type")?.includes("text/event-stream")) {
      const allMatches = [...text.matchAll(/^data: (.+)$/gm)];
      const lastMatch = allMatches[allMatches.length - 1];
      rpcResult = lastMatch?.[1] ? JSON.parse(lastMatch[1]) : null;
    } else {
      rpcResult = JSON.parse(text);
    }

    if (rpcResult?.error) {
      throw createError({ statusCode: 502, message: `MCP error: ${rpcResult.error.message || JSON.stringify(rpcResult.error)}` });
    }

    const tools: Array<{ name: string; description?: string; inputSchema?: any }> =
      rpcResult?.result?.tools ?? [];

    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? null,
      })),
    };
  } catch (err: any) {
    if (err.statusCode) throw err; // re-throw createError
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    throw createError({ statusCode: 502, message: `Could not reach MCP server: ${msg}` });
  } finally {
    clearTimeout(timer);
  }
});

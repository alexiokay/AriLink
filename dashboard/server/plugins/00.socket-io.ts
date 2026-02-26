import { Server as Engine } from "engine.io";
import { Server as SocketIOServer } from "socket.io";
import { defineEventHandler } from "h3";

function parseCookieHeader(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

export default defineNitroPlugin((nitroApp) => {
  const engine = new Engine();
  const io = new SocketIOServer();
  io.bind(engine);

  // Auth middleware: reject unauthenticated Socket.IO connections
  io.use((socket, next) => {
    const secret = process.env.DASHBOARD_SECRET;
    if (!secret) return next(); // Auth not enabled

    // Check handshake auth.token (explicit) or cookie (automatic)
    const token = socket.handshake.auth?.token;
    const cookieHeader = socket.handshake.headers.cookie || "";
    const cookies = parseCookieHeader(cookieHeader);
    const cookieToken = cookies["arilink-token"];

    if (token === secret || cookieToken === secret) {
      return next();
    }

    next(new Error("Authentication required"));
  });

  // Store io globally so the bootstrap plugin can access it
  (globalThis as any).__socketIO = io;

  // Route /socket.io/ HTTP requests to engine.io
  nitroApp.router.use(
    "/socket.io/",
    defineEventHandler({
      handler(event) {
        engine.handleRequest(event.node.req, event.node.res);
        event._handled = true;
      },
      websocket: {
        open(peer) {
          // Wire WebSocket upgrade to engine.io
          const rawReq = (peer as any).ctx?.node?.req;
          if (rawReq) {
            engine.handleUpgrade(rawReq, rawReq.socket, Buffer.alloc(0));
          }
        },
      },
    })
  );

  // Clean up on server shutdown
  nitroApp.hooks.hook("close", () => {
    io.close();
  });

  console.log("[Nitro] Socket.IO server initialized");
});

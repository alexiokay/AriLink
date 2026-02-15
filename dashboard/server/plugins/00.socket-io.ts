import { Server as Engine } from "engine.io";
import { Server as SocketIOServer } from "socket.io";
import { defineEventHandler } from "h3";

export default defineNitroPlugin((nitroApp) => {
  const engine = new Engine();
  const io = new SocketIOServer();
  io.bind(engine);

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

import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";

type AgentHubEvent =
  | { type: "agents-updated"; at: string; activeAgentId?: string }
  | { type: "history-updated"; at: string; agentId: string }
  | { type: "command-ack"; at: string; agentId: string; action: string; correlationId: string };

const sockets = new Set<Duplex>();
let server: Server | null = null;
const eventBus = new EventEmitter();

function wsPort(): number {
  return Number.parseInt(process.env.AGENT_HUB_WS_PORT ?? "4011", 10);
}

function frameText(message: string): Buffer {
  const data = Buffer.from(message, "utf8");
  const len = data.length;
  if (len < 126) {
    return Buffer.concat([Buffer.from([0x81, len]), data]);
  }
  if (len < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
    return Buffer.concat([header, data]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(len), 2);
  return Buffer.concat([header, data]);
}

function ensureServer(): void {
  if (server) return;
  server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, wsPort: wsPort() }));
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      // In dev with hot reload another instance may already own the WS port.
      return;
    }
    // Keep process stable; WS is auxiliary transport.
    return;
  });

  server.on("upgrade", (req, socket) => {
    if ((req.url ?? "").split("?")[0] !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key || typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"),
    );
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
    socket.on("data", () => {
      // Upstream messages are ignored in this one-way broadcast channel.
    });
  });

  try {
    server.listen(wsPort(), "127.0.0.1");
  } catch {
    /* ignore bind errors */
  }
}

export function publishAgentHubEvent(event: AgentHubEvent): void {
  ensureServer();
  eventBus.emit("event", event);
  const payload = frameText(JSON.stringify(event));
  for (const socket of sockets) {
    if (socket.destroyed) {
      sockets.delete(socket);
      continue;
    }
    socket.write(payload);
  }
}

export function onAgentHubEvent(listener: (event: AgentHubEvent) => void): () => void {
  eventBus.on("event", listener);
  return () => eventBus.off("event", listener);
}

export function getAgentHubWsUrl(): string {
  // Ensure WS server is listening before client tries to connect.
  ensureServer();
  return `ws://127.0.0.1:${wsPort()}/ws`;
}

import http from "node:http";
import { z } from "zod";

const ingestSchema = z
  .object({
    schemaVersion: z.string().optional(),
    snapshot: z.string().optional().default(""),
    cdpError: z.string().nullable().optional(),
  })
  .passthrough();

type HubState = {
  snapshot: string;
  cdpError: string | null;
  updatedAt: string;
};

let state: HubState = {
  snapshot: "",
  cdpError: null,
  updatedAt: new Date(0).toISOString(),
};

function readSecret(): string {
  return process.env.HUB_INGEST_SECRET ?? "";
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(s);
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authorize(req: http.IncomingMessage): boolean {
  const secret = readSecret();
  if (!secret) return false;
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === secret;
}

const port = Number.parseInt(process.env.PORT ?? "3010", 10);

const server = http.createServer(async (req, res) => {
  const path = req.url?.split("?")[0] ?? "";

  if (req.method === "GET" && path === "/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && path === "/state") {
    if (!authorize(req)) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    json(res, 200, { ...state });
    return;
  }

  if (req.method === "POST" && path === "/ingest") {
    if (!readSecret()) {
      json(res, 503, { error: "HUB_INGEST_SECRET не задан" });
      return;
    }
    if (!authorize(req)) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }

    let raw: unknown;
    try {
      const text = await parseBody(req);
      raw = text ? JSON.parse(text) : {};
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return;
    }

    const parsed = ingestSchema.safeParse(raw);
    if (!parsed.success) {
      json(res, 400, { error: "Invalid body" });
      return;
    }

    state = {
      snapshot: parsed.data.snapshot,
      cdpError: parsed.data.cdpError ?? null,
      updatedAt: new Date().toISOString(),
    };
    json(res, 200, { ok: true });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[agent-hub-gateway] http://0.0.0.0:${port} (ingest POST /ingest, state GET /state)`);
});

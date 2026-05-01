import { NextResponse } from "next/server";
import { onAgentHubEvent } from "@/lib/agent-hub-ws";
import { readHubAuthFromRequest } from "@/lib/hub-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await readHubAuthFromRequest(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowedOrigin = process.env.HUB_ALLOWED_ORIGIN ?? "";
  const origin = req.headers.get("origin") ?? "";
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      };
      send({ type: "connected", at: new Date().toISOString() });
      const unsubscribe = onAgentHubEvent((event) => send(event));
      const heartbeat = setInterval(() => {
        send({ type: "ping", at: new Date().toISOString() });
      }, 20_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

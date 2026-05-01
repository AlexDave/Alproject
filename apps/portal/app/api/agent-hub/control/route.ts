import { NextResponse } from "next/server";
import { z } from "zod";
import { readHubAuthFromRequest } from "@/lib/hub-auth";
import { fetchRelay } from "@/lib/agent-hub-relay";
import { normalizeHttpStatus } from "@/lib/http-status";
import { publishAgentHubEvent } from "@/lib/agent-hub-ws";
import { auditAgentHub } from "@/lib/agent-hub-audit";

const schema = z.object({
  action: z.enum(["continue", "send", "create"]),
  text: z.string().optional(),
  agentId: z.string().optional(),
  agentLabel: z.string().optional(),
  correlationId: z.string().optional(),
});
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await readHubAuthFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const allowedOrigin = process.env.HUB_ALLOWED_ORIGIN ?? "";
  const origin = req.headers.get("origin") ?? "";
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const correlationId = parsed.data.correlationId ?? crypto.randomUUID();
  let r: Response;
  try {
    r = await fetchRelay("/control", {
      method: "POST",
      agentId: parsed.data.agentId,
      body: JSON.stringify({
        action: parsed.data.action,
        text: parsed.data.text ?? "",
        agentId: parsed.data.agentId ?? "",
        agentLabel: parsed.data.agentLabel ?? "",
        correlationId,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Relay unavailable" },
      { status: 503 },
    );
  }

  let data: unknown = null;
  try {
    data = await r.json();
  } catch {
    data = { ok: false };
  }
  if (r.ok) {
    publishAgentHubEvent({
      type: "command-ack",
      agentId: parsed.data.agentId ?? "",
      correlationId,
      action: parsed.data.action,
      at: new Date().toISOString(),
    });
    auditAgentHub({
      actor: auth.sub,
      source: auth.source,
      action: parsed.data.action,
      agentId: parsed.data.agentId ?? "",
      correlationId,
      ok: true,
    });
  } else {
    auditAgentHub({
      actor: auth.sub,
      source: auth.source,
      action: parsed.data.action,
      agentId: parsed.data.agentId ?? "",
      correlationId,
      ok: false,
      detail: `HTTP ${r.status}`,
    });
  }
  const status = normalizeHttpStatus(r.status);
  return NextResponse.json(data ?? { ok: r.ok, correlationId }, { status });
}



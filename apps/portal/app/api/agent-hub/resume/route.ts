import { NextResponse } from "next/server";
import { z } from "zod";
import { readHubAuthFromRequest } from "@/lib/hub-auth";
import { fetchRelay } from "@/lib/agent-hub-relay";
import { normalizeHttpStatus } from "@/lib/http-status";
import { publishAgentHubEvent } from "@/lib/agent-hub-ws";
import { auditAgentHub } from "@/lib/agent-hub-audit";

const schema = z.object({
  agentId: z.string().trim().optional(),
  agentLabel: z.string().trim().optional(),
  correlationId: z.string().trim().optional(),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await readHubAuthFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const correlationId = parsed.data.correlationId ?? crypto.randomUUID();
  try {
    const r = await fetchRelay("/control", {
      method: "POST",
      agentId: parsed.data.agentId,
      body: JSON.stringify({
        action: "continue",
        agentId: parsed.data.agentId ?? "",
        agentLabel: parsed.data.agentLabel ?? "",
        correlationId,
      }),
    });
    const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!r.ok || !data.ok) {
      const status = normalizeHttpStatus(r.status);
      auditAgentHub({
        actor: auth.sub,
        source: auth.source,
        action: "resume",
        agentId: parsed.data.agentId,
        correlationId,
        ok: false,
        detail: data.error ?? `HTTP ${r.status}`,
      });
      return NextResponse.json({ error: data.error ?? `Relay HTTP ${r.status}` }, { status });
    }
    publishAgentHubEvent({
      type: "command-ack",
      at: new Date().toISOString(),
      action: "resume",
      agentId: parsed.data.agentId ?? "",
      correlationId,
    });
    auditAgentHub({
      actor: auth.sub,
      source: auth.source,
      action: "resume",
      agentId: parsed.data.agentId,
      correlationId,
      ok: true,
    });
    return NextResponse.json({ ok: true, correlationId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Relay unavailable" },
      { status: 503 },
    );
  }
}

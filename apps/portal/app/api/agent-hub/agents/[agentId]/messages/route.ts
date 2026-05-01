import { NextResponse } from "next/server";
import { z } from "zod";
import { readHubAuthFromRequest } from "@/lib/hub-auth";
import { fetchRelay } from "@/lib/agent-hub-relay";
import { normalizeHttpStatus } from "@/lib/http-status";
import { publishAgentHubEvent } from "@/lib/agent-hub-ws";
import { auditAgentHub } from "@/lib/agent-hub-audit";

const schema = z.object({
  text: z.string().trim().min(1),
  agentLabel: z.string().trim().optional(),
  correlationId: z.string().trim().optional(),
});

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const auth = await readHubAuthFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await params;
  const resolvedAgentId = decodeURIComponent(agentId ?? "").trim();
  if (!resolvedAgentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
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

  const correlationId = parsed.data.correlationId || crypto.randomUUID();
  try {
    const relayResponse = await fetchRelay(`/agents/${encodeURIComponent(resolvedAgentId)}/messages`, {
      method: "POST",
      agentId: resolvedAgentId,
      body: JSON.stringify({
        text: parsed.data.text,
        agentLabel: parsed.data.agentLabel ?? "",
        correlationId,
      }),
    });
    const raw = (await relayResponse.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!relayResponse.ok || !raw.ok) {
      const status = normalizeHttpStatus(relayResponse.status);
      return NextResponse.json({ error: raw.error ?? `Relay HTTP ${relayResponse.status}` }, { status });
    }
    publishAgentHubEvent({
      type: "command-ack",
      action: "send",
      agentId: resolvedAgentId,
      correlationId,
      at: new Date().toISOString(),
    });
    auditAgentHub({
      actor: auth.sub,
      source: auth.source,
      action: "send",
      agentId: resolvedAgentId,
      correlationId,
      ok: true,
    });
    return NextResponse.json({ ok: true, correlationId });
  } catch (error) {
    auditAgentHub({
      actor: auth.sub,
      source: auth.source,
      action: "send",
      agentId: resolvedAgentId,
      correlationId,
      ok: false,
      detail: error instanceof Error ? error.message : "Relay unavailable",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Relay unavailable" },
      { status: 503 },
    );
  }
}

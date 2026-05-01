import { NextResponse } from "next/server";
import { z } from "zod";
import { readHubAuthFromRequest } from "@/lib/hub-auth";
import { fetchRelay } from "@/lib/agent-hub-relay";
import { normalizeHttpStatus } from "@/lib/http-status";
import { publishAgentHubEvent } from "@/lib/agent-hub-ws";
import { auditAgentHub } from "@/lib/agent-hub-audit";

const schema = z.object({
  agentLabel: z.string().trim().min(1).optional(),
});

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const auth = await readHubAuthFromRequest(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { agentId } = await params;
  const resolvedAgentId = decodeURIComponent(agentId ?? "").trim();
  if (!resolvedAgentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });

  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    json = {};
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  try {
    const relayResponse = await fetchRelay(`/agents/${encodeURIComponent(resolvedAgentId)}/activate`, {
      method: "POST",
      agentId: resolvedAgentId,
      body: JSON.stringify({ agentLabel: parsed.data.agentLabel ?? "" }),
    });
    const raw = (await relayResponse.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!relayResponse.ok || !raw.ok) {
      const status = normalizeHttpStatus(relayResponse.status);
      return NextResponse.json({ error: raw.error ?? `Relay HTTP ${relayResponse.status}` }, { status });
    }
    publishAgentHubEvent({ type: "agents-updated", at: new Date().toISOString(), activeAgentId: resolvedAgentId });
    auditAgentHub({ actor: auth.sub, source: auth.source, action: "activate", agentId: resolvedAgentId, ok: true });
    return NextResponse.json({ ok: true, agentId: resolvedAgentId });
  } catch (error) {
    auditAgentHub({
      actor: auth.sub,
      source: auth.source,
      action: "activate",
      agentId: resolvedAgentId,
      ok: false,
      detail: error instanceof Error ? error.message : "Relay unavailable",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Relay unavailable" },
      { status: 503 },
    );
  }
}

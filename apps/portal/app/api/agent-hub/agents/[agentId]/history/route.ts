import { NextResponse } from "next/server";
import { readHubAuthFromRequest } from "@/lib/hub-auth";
import { fetchRelay, relayHistoryResponseSchema } from "@/lib/agent-hub-relay";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const auth = await readHubAuthFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await params;
  const resolvedAgentId = decodeURIComponent(agentId ?? "").trim();
  if (!resolvedAgentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  try {
    const relayResponse = await fetchRelay(`/agents/${encodeURIComponent(resolvedAgentId)}/history`, {
      method: "GET",
      agentId: resolvedAgentId,
    });
    const raw = await relayResponse.json().catch(() => ({}));
    if (!relayResponse.ok) {
      return NextResponse.json({
        ok: true,
        agentId: resolvedAgentId,
        stale: true,
        partial: true,
        source: "portal-fallback",
        history: [],
        warning: `Relay HTTP ${relayResponse.status}`,
      });
    }
    const parsed = relayHistoryResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({
        ok: true,
        agentId: resolvedAgentId,
        stale: true,
        partial: true,
        source: "portal-fallback",
        history: [],
        warning: "Relay returned invalid history payload",
      });
    }
    return NextResponse.json({
      ok: true,
      agentId: resolvedAgentId,
      stale: false,
      partial: parsed.data.history.length === 0,
      source: "relay-snapshot",
      history: parsed.data.history.map((item) => ({
        ...item,
        source: "relay-snapshot",
        timestamp: item.createdAt,
      })),
    });
  } catch (error) {
    const warning = error instanceof Error ? error.message : "Relay unavailable";
    return NextResponse.json({
      ok: true,
      agentId: resolvedAgentId,
      stale: true,
      partial: true,
      source: "portal-fallback",
      history: [],
      warning,
    });
  }
}

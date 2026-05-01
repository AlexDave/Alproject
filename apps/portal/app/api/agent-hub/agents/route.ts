import { NextResponse } from "next/server";
import { readHubAuthFromRequest } from "@/lib/hub-auth";
import { fetchRelay, relayAgentsResponseSchema } from "@/lib/agent-hub-relay";
import { normalizeHttpStatus } from "@/lib/http-status";
import { getAgentHub } from "@/lib/agent-hub-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await readHubAuthFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const relayResponse = await fetchRelay("/agents", { method: "GET" });
    const raw = await relayResponse.json().catch(() => ({}));
    if (!relayResponse.ok) {
      const status = normalizeHttpStatus(relayResponse.status);
      return NextResponse.json({ error: `Relay HTTP ${relayResponse.status}` }, { status });
    }
    const parsed = relayAgentsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Relay returned invalid agents payload" }, { status: 502 });
    }
    if (parsed.data.agents.length > 0) {
      return NextResponse.json({ ok: true, agents: parsed.data.agents });
    }
    const fallback = await getAgentHub();
    return NextResponse.json({
      ok: true,
      stale: true,
      staleReason: "relay_empty",
      agents: fallback.dialogs.map((dialog) => ({
        agentId: dialog.agentId,
        agentLabel: dialog.agentLabel,
        isActive: dialog.agentId === fallback.activeAgentId,
      })),
    });
  } catch (err) {
    const fallback = await getAgentHub();
    const hint = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: true,
      stale: true,
      staleReason: "relay_unreachable",
      hint,
      agents: fallback.dialogs.map((dialog) => ({
        agentId: dialog.agentId,
        agentLabel: dialog.agentLabel,
        isActive: dialog.agentId === fallback.activeAgentId,
      })),
    });
  }
}

import { NextResponse } from "next/server";
import { agentHubIngestBodySchema } from "@/lib/agent-hub-ingest-contract";
import { normalizeHttpStatus } from "@/lib/http-status";
import { setAgentHub } from "@/lib/agent-hub-store";
import { publishAgentHubEvent } from "@/lib/agent-hub-ws";

function backendBase(): string {
  return (process.env.AGENT_HUB_BACKEND_URL ?? "").replace(/\/$/, "");
}

export async function POST(req: Request) {
  const secret = process.env.HUB_INGEST_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "HUB_INGEST_SECRET не задан" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = backendBase();
  if (base) {
    const bodyText = await req.text();
    const r = await fetch(`${base}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
      body: bodyText,
    });
    const text = await r.text();
    const status = normalizeHttpStatus(r.status);
    return new NextResponse(text, {
      status,
      headers: { "Content-Type": r.headers.get("content-type") ?? "application/json" },
    });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = agentHubIngestBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  setAgentHub({
    agentId: parsed.data.agentId,
    agentLabel: parsed.data.agentLabel,
    agents: parsed.data.agents,
    snapshot: parsed.data.snapshot,
    cdpError: parsed.data.cdpError ?? null,
  });
  publishAgentHubEvent({
    type: "agents-updated",
    at: new Date().toISOString(),
    activeAgentId: parsed.data.agentId,
  });
  if (parsed.data.agentId) {
    publishAgentHubEvent({
      type: "history-updated",
      at: new Date().toISOString(),
      agentId: parsed.data.agentId,
    });
  }

  return NextResponse.json({ ok: true });
}

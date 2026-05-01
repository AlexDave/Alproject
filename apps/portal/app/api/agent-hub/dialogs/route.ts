import { NextResponse } from "next/server";
import { z } from "zod";
import { readHubAuthFromRequest } from "@/lib/hub-auth";
import { fetchRelay } from "@/lib/agent-hub-relay";
import { normalizeHttpStatus } from "@/lib/http-status";
import { publishAgentHubEvent } from "@/lib/agent-hub-ws";
import { auditAgentHub } from "@/lib/agent-hub-audit";

const schema = z
  .object({
    agentId: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-zA-Z0-9._-]+$/, "agentId: только буквы, цифры, точка, дефис и underscore")
      .optional(),
    agentLabel: z.string().trim().min(1).max(80).optional(),
  })
  .default({});

export async function POST(req: Request) {
  const auth = await readHubAuthFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  let relayResp: Response;
  try {
    relayResp = await fetchRelay("/control", {
      method: "POST",
      agentId: parsed.data.agentId,
      body: JSON.stringify({
        action: "create",
        agentId: parsed.data.agentId,
        agentLabel: parsed.data.agentLabel,
        correlationId: crypto.randomUUID(),
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Relay unavailable" },
      { status: 503 },
    );
  }
  if (!relayResp.ok) {
    const text = await relayResp.text().catch(() => "");
    const status = normalizeHttpStatus(relayResp.status);
    return NextResponse.json(
      { error: text.slice(0, 300) || `Relay create failed: HTTP ${relayResp.status}` },
      { status },
    );
  }

  publishAgentHubEvent({
    type: "agents-updated",
    at: new Date().toISOString(),
    activeAgentId: parsed.data.agentId,
  });
  auditAgentHub({
    actor: auth.sub,
    source: auth.source,
    action: "create",
    agentId: parsed.data.agentId,
    ok: true,
  });
  return NextResponse.json({
    ok: true,
    pending: true,
  });
}


type AuditPayload = {
  actor?: string;
  source?: string;
  action: string;
  agentId?: string;
  correlationId?: string;
  ok: boolean;
  detail?: string;
};

export function auditAgentHub(payload: AuditPayload): void {
  const line = {
    ts: new Date().toISOString(),
    channel: "agent-hub",
    ...payload,
  };
  console.info(JSON.stringify(line));
}

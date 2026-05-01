export async function pushAgentHub(
  baseUrl: string,
  ingestSecret: string,
  payload: {
    agentId: string;
    agentLabel: string;
    snapshot: string;
    cdpError: string | null;
    agents?: Array<{ agentId: string; agentLabel: string; isActive?: boolean }>;
  },
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/agent-hub/ingest`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ingestSecret}`,
    },
    body: JSON.stringify({ schemaVersion: '1', ...payload }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Hub ${r.status}: ${t}`);
  }
}

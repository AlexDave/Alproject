export type AgentHubDialog = {
  agentId: string;
  agentLabel: string;
  snapshot: string;
  cdpError: string | null;
  updatedAt: string;
};

export type AgentHubState = {
  activeAgentId: string;
  snapshot: string;
  cdpError: string | null;
  updatedAt: string;
  dialogs: AgentHubDialog[];
};

const EPOCH = new Date(0).toISOString();
const DEFAULT_AGENT_ID = "default";
const DEFAULT_AGENT_LABEL = "Cursor Agent";

let memoryDialogs: AgentHubDialog[] = [
  {
    agentId: DEFAULT_AGENT_ID,
    agentLabel: DEFAULT_AGENT_LABEL,
    snapshot: "",
    cdpError: null,
    updatedAt: EPOCH,
  },
];

let memoryActiveAgentId = DEFAULT_AGENT_ID;

function backendBase(): string {
  return (process.env.AGENT_HUB_BACKEND_URL ?? "").replace(/\/$/, "");
}

function normalizeAgentId(value: string | undefined): string {
  const v = (value ?? "").trim();
  return v || DEFAULT_AGENT_ID;
}

function normalizeAgentLabel(agentId: string, value: string | undefined): string {
  const v = (value ?? "").trim();
  if (v) return v;
  return agentId === DEFAULT_AGENT_ID ? DEFAULT_AGENT_LABEL : agentId;
}

function toHubState(activeId: string, dialogs: AgentHubDialog[]): AgentHubState {
  const active = dialogs.find((d) => d.agentId === activeId) ?? dialogs[0];
  return {
    activeAgentId: active.agentId,
    snapshot: active.snapshot,
    cdpError: active.cdpError,
    updatedAt: active.updatedAt,
    dialogs,
  };
}

export function setAgentHub(next: {
  agentId?: string;
  agentLabel?: string;
  agents?: Array<{ agentId: string; agentLabel: string; isActive?: boolean }>;
  snapshot?: string;
  cdpError?: string | null;
}): void {
  const now = new Date().toISOString();

  if (Array.isArray(next.agents) && next.agents.length > 0) {
    const byId = new Map(memoryDialogs.map((d) => [d.agentId, d]));
    const normalized = next.agents
      .map((a) => {
        const agentId = normalizeAgentId(a.agentId);
        const prev = byId.get(agentId);
        return {
          agentId,
          agentLabel: normalizeAgentLabel(agentId, a.agentLabel),
          snapshot: prev?.snapshot ?? "",
          cdpError: prev?.cdpError ?? null,
          updatedAt: prev?.updatedAt ?? EPOCH,
          isActive: !!a.isActive,
        };
      })
      .filter((d, idx, arr) => arr.findIndex((x) => x.agentId === d.agentId) === idx);

    const activeFromParsed = normalized.find((x) => x.isActive)?.agentId;
    const activeFallback = normalizeAgentId(next.agentId);
    memoryDialogs = normalized.map(({ isActive, ...dialog }) => dialog);
    memoryActiveAgentId = activeFromParsed ?? activeFallback ?? memoryDialogs[0]?.agentId ?? DEFAULT_AGENT_ID;
  }

  const agentId = normalizeAgentId(next.agentId ?? memoryActiveAgentId);
  const existing = memoryDialogs.find((d) => d.agentId === agentId);
  const updatedDialog: AgentHubDialog = {
    agentId,
    agentLabel: normalizeAgentLabel(agentId, next.agentLabel ?? existing?.agentLabel),
    snapshot: next.snapshot ?? existing?.snapshot ?? "",
    cdpError: next.cdpError !== undefined ? next.cdpError : existing?.cdpError ?? null,
    updatedAt: now,
  };
  const others = memoryDialogs.filter((d) => d.agentId !== agentId);
  memoryDialogs = [updatedDialog, ...others];
  memoryActiveAgentId = agentId;
}

export async function getAgentHub(): Promise<AgentHubState> {
  const base = backendBase();
  if (!base) {
    return toHubState(memoryActiveAgentId, [...memoryDialogs]);
  }

  const secret = process.env.HUB_INGEST_SECRET ?? "";
  const r = await fetch(`${base}/state`, {
    cache: "no-store",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    const msg = `Шлюз agent-hub: ${r.status} ${errText.slice(0, 200)}`;
    return toHubState(DEFAULT_AGENT_ID, [
      {
        agentId: DEFAULT_AGENT_ID,
        agentLabel: DEFAULT_AGENT_LABEL,
        snapshot: "",
        cdpError: msg,
        updatedAt: new Date().toISOString(),
      },
    ]);
  }

  const j = (await r.json()) as Partial<AgentHubState> & { dialogs?: unknown };
  const remoteDialogs = Array.isArray(j.dialogs)
    ? j.dialogs
        .map((x) => {
          const v = x as Partial<AgentHubDialog>;
          const agentId = normalizeAgentId(v.agentId);
          return {
            agentId,
            agentLabel: normalizeAgentLabel(agentId, v.agentLabel),
            snapshot: typeof v.snapshot === "string" ? v.snapshot : "",
            cdpError: v.cdpError !== undefined ? v.cdpError : null,
            updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : EPOCH,
          } satisfies AgentHubDialog;
        })
        .filter((d, idx, arr) => arr.findIndex((x) => x.agentId === d.agentId) === idx)
    : [];
  if (remoteDialogs.length > 0) {
    return toHubState(normalizeAgentId(j.activeAgentId), remoteDialogs);
  }

  return toHubState(DEFAULT_AGENT_ID, [
    {
      agentId: DEFAULT_AGENT_ID,
      agentLabel: DEFAULT_AGENT_LABEL,
      snapshot: typeof j.snapshot === "string" ? j.snapshot : "",
      cdpError: j.cdpError !== undefined ? j.cdpError : null,
      updatedAt: typeof j.updatedAt === "string" ? j.updatedAt : EPOCH,
    },
  ]);
}

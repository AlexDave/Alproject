import { z } from "zod";

const relayAgentSchema = z.object({
  agentId: z.string().min(1),
  agentLabel: z.string().min(1),
  isActive: z.boolean().optional(),
  cursorDialogId: z.string().optional(),
});

export const relayAgentsResponseSchema = z.object({
  ok: z.boolean().optional(),
  agents: z.array(relayAgentSchema).default([]),
});

export const relayHistoryResponseSchema = z.object({
  ok: z.boolean().optional(),
  agentId: z.string().min(1),
  history: z
    .array(
      z.object({
        id: z.string().min(1),
        role: z.enum(["assistant"]),
        text: z.string(),
        createdAt: z.string(),
        cursorDialogId: z.string().optional(),
      }),
    )
    .default([]),
});

export type RelayAgent = z.infer<typeof relayAgentSchema>;
export type RelayHistoryMessage = z.infer<typeof relayHistoryResponseSchema>["history"][number];

function relayMap(): Record<string, string> {
  const raw = process.env.AGENT_CONTROL_URLS_JSON ?? "";
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === "string" && value.trim())
        .map(([key, value]) => [key, (value as string).trim()]),
    );
  } catch {
    return {};
  }
}

export function resolveRelayBaseUrl(agentId?: string): string {
  const map = relayMap();
  if (agentId && map[agentId]) return map[agentId];
  return process.env.AGENT_CONTROL_URL ?? "http://127.0.0.1:4000";
}

export function hubRelaySecret(): string {
  return process.env.HUB_CONTROL_SECRET ?? process.env.HUB_INGEST_SECRET ?? "";
}

function relayUnreachableMessage(base: string, err: unknown): string {
  let code = "";
  if (err instanceof Error && err.cause instanceof Error && "code" in err.cause) {
    code = String((err.cause as NodeJS.ErrnoException).code ?? "");
  }
  const lower = base.toLowerCase();
  const dockerHint =
    lower.includes("127.0.0.1") || lower.includes("localhost")
      ? " Если портал в Docker, relay на машине-хосте: AGENT_CONTROL_URL=http://host.docker.internal:4000 (или IP хоста), не 127.0.0.1."
      : "";
  const bindHint =
    lower.includes("host.docker.internal") && (code === "ECONNREFUSED" || (err instanceof Error && err.message === "fetch failed"))
      ? " На стороне relay в .env: AGENT_CONTROL_BIND=0.0.0.0 (портал в Docker доходит только так; API всё равно по секрету)."
      : "";
  const connHint =
    code === "ECONNREFUSED" || (err instanceof Error && err.message === "fetch failed")
      ? ` Запустите cursor-agent-telegram (HTTP control, порт 4000 по умолчанию), общий HUB_CONTROL_SECRET.${dockerHint}${bindHint}`
      : "";
  return `${err instanceof Error ? err.message : "Relay unavailable"}${code ? ` (${code})` : ""}.${connHint}`;
}

export async function fetchRelay(pathname: string, init: RequestInit & { agentId?: string }): Promise<Response> {
  const secret = hubRelaySecret();
  if (!secret) throw new Error("HUB_CONTROL_SECRET (или HUB_INGEST_SECRET) не задан");
  const base = resolveRelayBaseUrl(init.agentId);
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${secret}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = `${base.replace(/\/$/, "")}${pathname}`;
  try {
    return await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(relayUnreachableMessage(base, err));
  }
}

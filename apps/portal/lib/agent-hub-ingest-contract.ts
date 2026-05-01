import { z } from "zod";

/** Текущая версия контракта тела POST /api/agent-hub/ingest и POST .../ingest на gateway. */
export const AGENT_HUB_INGEST_SCHEMA_VERSION = "1";

export const agentHubIngestBodySchema = z
  .object({
    schemaVersion: z.string().optional(),
    agentId: z.string().min(1).optional(),
    agentLabel: z.string().min(1).optional(),
    agents: z
      .array(
        z.object({
          agentId: z.string().min(1),
          agentLabel: z.string().min(1),
          isActive: z.boolean().optional(),
        }),
      )
      .optional(),
    snapshot: z.string().optional().default(""),
    cdpError: z.string().nullable().optional(),
    messages: z
      .array(
        z.object({
          id: z.string().min(1).optional(),
          role: z.string().min(1),
          text: z.string().default(""),
          createdAt: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export type AgentHubIngestBody = z.infer<typeof agentHubIngestBodySchema>;

export function parseAgentHubIngestBody(raw: unknown): AgentHubIngestBody {
  const parsed = agentHubIngestBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid agent-hub ingest body");
  }
  return parsed.data;
}

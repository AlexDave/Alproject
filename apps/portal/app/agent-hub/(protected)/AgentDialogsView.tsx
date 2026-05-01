"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AgentControl } from "./AgentControl";
import type { AgentHubDialog } from "@/lib/agent-hub-store";

type Props = {
  dialogs: AgentHubDialog[];
  /** Ingest идёт в agent-hub-gateway: после router.refresh() сервер отдаёт один synthetic default-диалог — не затирать список агентов с relay. */
  gatewayIngestMode?: boolean;
};

const EPOCH = new Date(0).toISOString();
type HistoryItem = { id: string; role: "assistant"; text: string; createdAt: string };

export function AgentDialogsView({ dialogs: initialDialogs, gatewayIngestMode = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dialogs, setDialogs] = useState<AgentHubDialog[]>(initialDialogs);
  const [creating, setCreating] = useState(false);
  const [isAgentsLoading, setIsAgentsLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [selectMsg, setSelectMsg] = useState<string | null>(null);
  const selectedFromQuery = (searchParams.get("agent") ?? "").trim();

  useEffect(() => {
    if (!gatewayIngestMode) {
      setDialogs(initialDialogs);
      return;
    }
    const stub = initialDialogs[0];
    if (!stub) return;
    setDialogs((prev) => {
      if (prev.length === 0) return initialDialogs;
      const applyToId = selectedFromQuery || prev[0]?.agentId;
      if (!applyToId) return initialDialogs;
      let matched = false;
      const next = prev.map((d) => {
        if (d.agentId !== applyToId) return d;
        matched = true;
        return {
          ...d,
          snapshot: stub.snapshot,
          cdpError: stub.cdpError,
          updatedAt: stub.updatedAt,
        };
      });
      return matched ? next : prev;
    });
  }, [initialDialogs, gatewayIngestMode, selectedFromQuery]);

  const selected = useMemo(() => {
    if (dialogs.length === 0) return null;
    return dialogs.find((d) => d.agentId === selectedFromQuery) ?? dialogs[0];
  }, [dialogs, selectedFromQuery]);

  const loadAgents = useCallback(async () => {
    setIsAgentsLoading(true);
    try {
      const r = await fetch("/api/agent-hub/agents", { cache: "no-store" });
      const data = (await r.json().catch(() => ({}))) as {
        agents?: Array<{ agentId: string; agentLabel: string; isActive?: boolean }>;
      };
      if (!r.ok || !data.agents) return;
      setDialogs((prevDialogs) =>
        data.agents!.map((item) => {
          const prev = prevDialogs.find((d) => d.agentId === item.agentId);
          return {
            agentId: item.agentId,
            agentLabel: item.agentLabel,
            cdpError: prev?.cdpError ?? null,
            snapshot: prev?.snapshot ?? "",
            updatedAt: prev?.updatedAt ?? EPOCH,
          };
        }),
      );
    } finally {
      setIsAgentsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (agentId: string, mode: "reset" | "soft" = "reset") => {
    if (mode === "reset") {
      setIsHistoryLoading(true);
      setHistory([]);
    }
    try {
      const r = await fetch(`/api/agent-hub/agents/${encodeURIComponent(agentId)}/history`, { cache: "no-store" });
      const data = (await r.json().catch(() => ({}))) as { history?: HistoryItem[] };
      if (r.ok && Array.isArray(data.history)) {
        setHistory(data.history);
      }
    } finally {
      if (mode === "reset") setIsHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadAgents();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAgents]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const run = async () => {
      await loadHistory(selected.agentId);
    };
    void (async () => {
      await run();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHistory, selected?.agentId]);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 500;

    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/agent-hub/events", { withCredentials: true });
      es.onopen = () => {
        reconnectDelay = 500;
      };
      es.onmessage = (event) => {
        const payload = JSON.parse(event.data) as {
          type?: string;
          agentId?: string;
        };
        if (payload.type === "agents-updated") {
          void loadAgents();
        }
        if (payload.type === "history-updated" && payload.agentId && payload.agentId === selected?.agentId) {
          void loadHistory(payload.agentId, "soft");
        }
      };

      es.onerror = () => {
        es?.close();
        if (cancelled) return;
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(5000, reconnectDelay * 2);
          connect();
        }, reconnectDelay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [loadAgents, loadHistory, selected?.agentId]);

  const onSelect = async (agentId: string) => {
    setIsHistoryLoading(true);
    setHistory([]);
    const dialog = dialogs.find((d) => d.agentId === agentId);
    if (dialog) {
      const r = await fetch(`/api/agent-hub/agents/${encodeURIComponent(agentId)}/activate`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentLabel: dialog.agentLabel, correlationId: crypto.randomUUID() }),
      });
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !data.ok) setSelectMsg(`Не удалось переключить IDE: ${data.error ?? `HTTP ${r.status}`}`);
      else setSelectMsg(null);
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("agent", agentId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const r = await fetch("/api/agent-hub/dialogs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !data.ok) return;
      void loadAgents();
    } finally {
      setCreating(false);
    }
  };

  if (!selected) return null;

  return (
    <section className="agent-hub-chat-layout">
      <aside className="agent-hub-chat-list" aria-label="Список диалогов агентов">
        <form className="agent-hub-new-agent" onSubmit={onCreate}>
          <button className="agent-hub-btn" type="submit" disabled={creating}>
            Создать нового агента
          </button>
        </form>

        {isAgentsLoading ? <p className="agent-hub-history-loading">Загрузка списка агентов...</p> : null}

        {dialogs.map((dialog) => {
          const active = dialog.agentId === selected.agentId;
          return (
            <button
              type="button"
              key={dialog.agentId}
              className={`agent-hub-chat-item${active ? " agent-hub-chat-item--active" : ""}`}
              onClick={() => void onSelect(dialog.agentId)}
            >
              <span className="agent-hub-chat-item-title">{dialog.agentLabel}</span>
              <span className="agent-hub-chat-item-sub">id: {dialog.agentId}</span>
              <span className="agent-hub-chat-item-sub">
                {dialog.updatedAt === EPOCH ? "ещё нет данных" : new Date(dialog.updatedAt).toLocaleString("ru-RU")}
              </span>
            </button>
          );
        })}
        {selectMsg ? <p className="agent-hub-new-agent-msg">{selectMsg}</p> : null}
      </aside>

      <div className="agent-hub-chat-main">
        <section className="agent-hub-section agent-hub-dialog">
          <div className="agent-hub-dialog-head">
            <h2 className="agent-hub-h2">{selected.agentLabel}</h2>
            <p className="agent-hub-dialog-meta">
              <span>id: {selected.agentId}</span>
              <span>
                обновлено:{" "}
                {selected.updatedAt === EPOCH ? "ещё не было данных" : new Date(selected.updatedAt).toLocaleString("ru-RU")}
              </span>
            </p>
          </div>
          {selected.cdpError ? (
            <section className="agent-hub-section agent-hub-error">
              <h3 className="agent-hub-h3">CDP</h3>
              <pre className="agent-hub-pre">{selected.cdpError}</pre>
            </section>
          ) : null}
          {!selected.snapshot.trim() && selected.updatedAt !== EPOCH ? (
            <p className="agent-hub-hint agent-hub-hint--snapshot">
              Ingest приходит, но текст пустой — откройте панель агента в Cursor, проверьте{" "}
              <code>--remote-debugging-port=9222</code> и селекторы в <code>cursor-session.ts</code>.
            </p>
          ) : null}
          <section className="agent-hub-section">
            <h3 className="agent-hub-h3">Сообщения</h3>
            <pre className="agent-hub-pre agent-hub-pre--history">
              {isHistoryLoading ? (
                <span className="agent-hub-history-loading">Загрузка истории сообщений...</span>
              ) : history.length > 0 ? (
                history
                  .slice()
                  .reverse()
                  .map((item) => `[${new Date(item.createdAt).toLocaleTimeString("ru-RU")}] ${item.role}: ${item.text}`)
                  .join("\n\n")
              ) : (
                selected.snapshot.trim() ||
                "Пусто — запустите cursor-agent-telegram с HUB_URL и HUB_INGEST_SECRET или дождитесь первого ingest."
              )}
            </pre>
          </section>
        </section>

        <AgentControl
          agentId={selected.agentId}
          agentLabel={selected.agentLabel}
          onInstructionSent={() => {
            const attempts = [700, 1600, 3000, 5000];
            for (const delay of attempts) {
              window.setTimeout(() => {
                void loadHistory(selected.agentId, "soft");
              }, delay);
            }
          }}
        />
      </div>
    </section>
  );
}


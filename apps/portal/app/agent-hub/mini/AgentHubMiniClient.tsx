"use client";

import { useEffect, useMemo, useState } from "react";

type Agent = { agentId: string; agentLabel: string; isActive?: boolean };
type HistoryItem = { id: string; role: string; text: string; timestamp?: string; createdAt?: string };

function tgInitData(): string {
  const w = window as Window & { Telegram?: { WebApp?: { initData?: string; ready?: () => void } } };
  const initData = w.Telegram?.WebApp?.initData ?? "";
  w.Telegram?.WebApp?.ready?.();
  return initData;
}

export function AgentHubMiniClient() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = useMemo(() => agents.find((a) => a.agentId === selectedAgentId) ?? agents[0], [agents, selectedAgentId]);

  async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  }

  async function loadAgents(currentToken: string) {
    const r = await fetch("/api/agent-hub/agents", {
      headers: { Authorization: `Bearer ${currentToken}` },
      cache: "no-store",
    });
    const data = (await r.json().catch(() => ({}))) as { agents?: Agent[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    const nextAgents = data.agents ?? [];
    setAgents(nextAgents);
    setSelectedAgentId((prev) => {
      if (nextAgents.length === 0) return "";
      if (!prev) return nextAgents[0].agentId;
      return nextAgents.some((a) => a.agentId === prev) ? prev : nextAgents[0].agentId;
    });
  }

  async function loadHistory(agentId: string, currentToken = token) {
    const r = await fetch(`/api/agent-hub/agents/${encodeURIComponent(agentId)}/history`, {
      headers: { Authorization: `Bearer ${currentToken}` },
      cache: "no-store",
    });
    const data = (await r.json().catch(() => ({}))) as { history?: HistoryItem[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    setHistory(data.history ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const initData = tgInitData();
        if (!initData) throw new Error("Mini App initData пустой");
        const r = await fetch("/api/agent-hub/miniapp/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        const data = (await r.json().catch(() => ({}))) as { accessToken?: string; error?: string };
        if (!r.ok || !data.accessToken) throw new Error(data.error ?? `HTTP ${r.status}`);
        if (cancelled) return;
        setToken(data.accessToken);
        await loadAgents(data.accessToken);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Auth failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
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
        const payload = JSON.parse(event.data) as { type?: string; agentId?: string };
        if (payload.type === "agents-updated") void loadAgents(token);
        if (payload.type === "history-updated" && payload.agentId && payload.agentId === selected?.agentId) {
          void loadHistory(payload.agentId, token);
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
      es?.close();
    };
  }, [selected?.agentId, token]);

  useEffect(() => {
    if (!selected?.agentId || !token) return;
    void loadHistory(selected.agentId);
  }, [selected?.agentId, token]);

  async function activate(agent: Agent) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await authedFetch(`/api/agent-hub/agents/${encodeURIComponent(agent.agentId)}/activate`, {
        method: "POST",
        body: JSON.stringify({ agentLabel: agent.agentLabel }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setSelectedAgentId(agent.agentId);
      setNotice(`Активный агент: ${agent.agentLabel}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось переключить агента");
    } finally {
      setBusy(false);
    }
  }

  async function sendPrompt() {
    if (!selected?.agentId || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await authedFetch(`/api/agent-hub/agents/${encodeURIComponent(selected.agentId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: prompt, agentLabel: selected.agentLabel, correlationId: crypto.randomUUID() }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setPrompt("");
      await loadHistory(selected.agentId);
      setNotice("Инструкция отправлена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setBusy(false);
    }
  }

  async function onResume() {
    if (!selected?.agentId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await authedFetch("/api/agent-hub/resume", {
        method: "POST",
        body: JSON.stringify({
          agentId: selected.agentId,
          agentLabel: selected.agentLabel,
          correlationId: crypto.randomUUID(),
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setNotice("Команда Continue отправлена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка resume");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateDialog() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await authedFetch("/api/agent-hub/dialogs", { method: "POST", body: JSON.stringify({}) });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      await loadAgents(token);
      setNotice("Создан новый диалог.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания диалога");
    } finally {
      setBusy(false);
    }
  }

  async function onRefresh() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await loadAgents(token);
      if (selected?.agentId) await loadHistory(selected.agentId, token);
      setNotice("Данные обновлены.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обновления");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="agent-hub-mini-layout">
      <h1 className="agent-hub-title">Cursor Agent Mini App</h1>
      {selected ? (
        <p className="agent-hub-control-target">
          Активный собеседник: <strong>{selected.agentLabel}</strong> (<code>{selected.agentId}</code>)
        </p>
      ) : null}
      {error ? <p className="agent-hub-login-error">{error}</p> : null}
      {notice ? <p className="agent-hub-control-msg">{notice}</p> : null}
      <div className="agent-hub-mini-agents">
        {agents.map((agent) => (
          <button
            key={agent.agentId}
            type="button"
            className={`agent-hub-chat-item${selected?.agentId === agent.agentId ? " agent-hub-chat-item--active" : ""}`}
            onClick={() => void activate(agent)}
            disabled={busy}
          >
            <span className="agent-hub-chat-item-title">{agent.agentLabel}</span>
            <span className="agent-hub-chat-item-sub">{agent.agentId}</span>
          </button>
        ))}
      </div>
      <div className="agent-hub-control-row">
        <button className="agent-hub-btn" type="button" disabled={busy} onClick={() => void onResume()}>
          Продолжить
        </button>
        <button className="agent-hub-btn agent-hub-btn-secondary" type="button" disabled={busy} onClick={() => void onCreateDialog()}>
          Новый агент
        </button>
        <button className="agent-hub-btn agent-hub-btn-secondary" type="button" disabled={busy || !token} onClick={() => void onRefresh()}>
          Обновить
        </button>
      </div>
      <pre className="agent-hub-pre agent-hub-pre--history">
        {history
          .slice()
          .reverse()
          .map((item) => `[${new Date(item.timestamp ?? item.createdAt ?? Date.now()).toLocaleTimeString("ru-RU")}] ${item.role}: ${item.text}`)
          .join("\n\n") || "История пуста"}
      </pre>
      <label className="agent-hub-control-label">
        Инструкция
        <textarea
          className="agent-hub-textarea"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy && prompt.trim()) void sendPrompt();
            }
          }}
          placeholder="Напишите, что агент должен сделать дальше..."
        />
      </label>
      <button className="agent-hub-btn" type="button" disabled={busy || !prompt.trim()} onClick={() => void sendPrompt()}>
        Отправить
      </button>
    </section>
  );
}

"use client";

import { useState } from "react";

async function postControl(
  action: "continue",
  agentId: string,
  agentLabel: string,
  text?: string,
): Promise<{ ok?: boolean; error?: string }> {
  const endpoint = action === "continue" ? "/api/agent-hub/resume" : "/api/agent-hub/control";
  const r = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      text: text ?? "",
      agentId,
      agentLabel,
      correlationId: crypto.randomUUID(),
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok) {
    return { ok: false, error: data.error ?? `HTTP ${r.status}` };
  }
  return data;
}

export function AgentControl({
  agentId,
  agentLabel,
  onInstructionSent,
}: {
  agentId: string;
  agentLabel: string;
  onInstructionSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onContinue() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postControl("continue", agentId, agentLabel);
      if (r.error) setMsg(`Ошибка: ${r.error}`);
      else setMsg("Команда отправлена в Cursor.");
    } finally {
      setBusy(false);
    }
  }

  async function sendInstructionNow() {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const rResp = await fetch(`/api/agent-hub/agents/${encodeURIComponent(agentId)}/messages`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, agentLabel, correlationId: crypto.randomUUID() }),
      });
      const r = (await rResp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!rResp.ok) {
        setMsg(`Ошибка: ${r.error ?? `HTTP ${rResp.status}`}`);
        return;
      }
      if (r.error) setMsg(`Ошибка: ${r.error}`);
      else {
        setMsg("Инструкция отправлена в Cursor.");
        setText("");
        onInstructionSent?.();
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    await sendInstructionNow();
  }

  return (
    <section className="agent-hub-control">
      <h2 className="agent-hub-h2">Управление</h2>
      <p className="agent-hub-control-target">
        Активный собеседник: <strong>{agentLabel}</strong> (<code>{agentId}</code>)
      </p>

      <div className="agent-hub-control-row">
        <button className="agent-hub-btn" type="button" onClick={() => void onContinue()} disabled={busy}>
          Продолжить агента
        </button>
      </div>

      <form className="agent-hub-control-form" onSubmit={onSend}>
        <label className="agent-hub-control-label">
          Новая инструкция
          <textarea
            className="agent-hub-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!busy && text.trim()) void sendInstructionNow();
              }
            }}
            rows={4}
            placeholder="Напишите, что агент должен сделать дальше…"
          />
        </label>
        <div className="agent-hub-control-actions">
          <button className="agent-hub-btn" type="submit" disabled={busy || !text.trim()}>
            Отправить
          </button>
        </div>
      </form>

      {msg ? <p className="agent-hub-control-msg">{msg}</p> : null}
    </section>
  );
}


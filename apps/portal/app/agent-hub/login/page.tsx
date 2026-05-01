"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AgentHubLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const r = await fetch("/api/agent-hub/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(data.error ?? `Ошибка ${r.status}`);
        return;
      }
      router.replace("/agent-hub");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="agent-hub-login">
      <h1 className="agent-hub-login-title">Hub агента</h1>
      <p className="agent-hub-login-lead">Вход по паролю (локальный портал).</p>
      <form className="agent-hub-login-form" onSubmit={onSubmit}>
        <label className="agent-hub-login-label">
          Пароль
          <input
            className="agent-hub-login-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <p className="agent-hub-login-error">{error}</p> : null}
        <button className="agent-hub-login-submit" type="submit" disabled={pending}>
          {pending ? "…" : "Войти"}
        </button>
      </form>
    </main>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";

type Props = {
  text: string;
  emptyLabel: string;
};

function snapshotLineClass(line: string): string {
  const t = line.trimStart();
  if (!t) return "agent-hub-snap-line agent-hub-snap-line--empty";
  if (/^Ran command:/i.test(t)) return "agent-hub-snap-line agent-hub-snap-line--cmd";
  if (/^Explored\d+/i.test(t)) return "agent-hub-snap-line agent-hub-snap-line--tool";
  if (/^>\s*(tsc|npm)\b/i.test(t)) return "agent-hub-snap-line agent-hub-snap-line--compile";
  if (/^\$cd\s|^\$\s|^(?:cd\s+")/i.test(t)) return "agent-hub-snap-line agent-hub-snap-line--shell";
  if (/^(HAS __name|ok no __name)$/i.test(t)) return "agent-hub-snap-line agent-hub-snap-line--badge";
  if (/^\s*\/\*\*|\s*\*\/\s*$|^\s+\*\s/.test(t) || /^\s*\*/.test(t))
    return "agent-hub-snap-line agent-hub-snap-line--comment";
  if (/[\w.-]+\.(?:tsx?|ts|js|mdc|md)[+-]\d+[+-]\d+/.test(t) && t.length < 160)
    return "agent-hub-snap-line agent-hub-snap-line--file";
  return "agent-hub-snap-line agent-hub-snap-line--text";
}

function selectPreContents(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function SnapshotPanel({ text, emptyLabel }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const trimmed = text.trim();
  const display = text || emptyLabel;
  const lines = useMemo(() => display.split("\n"), [display]);
  const isEmpty = !trimmed;

  const copy = useCallback(async () => {
    if (!trimmed) return;
    try {
      await navigator.clipboard.writeText(trimmed);
      setMsg("Скопировано в буфер");
      window.setTimeout(() => setMsg(null), 2000);
    } catch {
      setMsg("Выделите текст ниже и скопируйте вручную (Ctrl+C)");
      window.setTimeout(() => setMsg(null), 4000);
    }
  }, [trimmed]);

  return (
    <div className="agent-hub-snapshot-panel">
      <div className="agent-hub-snapshot-toolbar">
        <button
          className="agent-hub-btn agent-hub-btn-secondary"
          type="button"
          onClick={() => void copy()}
          disabled={!trimmed}
        >
          Копировать снимок
        </button>
        {msg ? <span className="agent-hub-snapshot-msg">{msg}</span> : null}
      </div>
      <pre
        className="agent-hub-snapshot-pre agent-hub-snapshot-pre--panel"
        tabIndex={isEmpty ? -1 : 0}
        aria-label="Снимок панели агента Cursor"
        onClick={(e) => {
          if (!isEmpty) selectPreContents(e.currentTarget);
        }}
        onFocus={(e) => {
          if (!isEmpty) selectPreContents(e.currentTarget);
        }}
      >
        {lines.map((line, i) => (
          <span key={i} className={snapshotLineClass(line)}>
            {line}
          </span>
        ))}
      </pre>
      <p className="agent-hub-snapshot-tip">
        Клик по области выделяет весь текст — удобно копировать, пока страница не обновилась.
      </p>
    </div>
  );
}

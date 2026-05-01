"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const STALE_REFRESH_MS = 45_000;

function shouldDeferRefresh(): boolean {
  const hub = document.querySelector(".agent-hub");
  if (!hub) return false;

  const el = document.activeElement;
  if (el && hub.contains(el) && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
    return true;
  }

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const panel = document.querySelector(".agent-hub-snapshot-panel");
  if (!panel) return false;
  let node: Node | null = sel.anchorNode;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (node && panel.contains(node)) return true;

  return false;
}

/**
 * Периодический router.refresh() после ingest.
 * Не дергает refresh, пока фокус в поле ввода/инструкции или есть выделение в блоке снимка —
 * иначе сбрасывается копирование и мешает набору текста.
 */
export function HubAutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOkRef = useRef<number>(Date.now());

  useEffect(() => {
    const tick = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const stale = Date.now() - lastOkRef.current > STALE_REFRESH_MS;
        if (!stale && shouldDeferRefresh()) return;
        try {
          router.refresh();
          lastOkRef.current = Date.now();
        } catch {
          /* ignore */
        }
      }, 150);
    };

    const id = setInterval(tick, intervalMs);
    return () => {
      clearInterval(id);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [router, intervalMs]);

  return null;
}

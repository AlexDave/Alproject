/**
 * Проверка, что endpoint CDP Chrome/Chromium отвечает как при remote debugging (список целей).
 * Используется перед запуском опроса, чтобы сразу увидеть «порт не слушает».
 */
export type CdpProbeResult = { ok: true } | { ok: false; reason: string };

export function cdpJsonUrl(cdpUrl: string): string {
  const base = cdpUrl.replace(/\/$/, '');
  return `${base}/json`;
}

export async function probeCdpEndpoint(cdpUrl: string, timeoutMs = 3500): Promise<CdpProbeResult> {
  const url = cdpJsonUrl(cdpUrl);
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (!r.ok) {
      return { ok: false, reason: `HTTP ${r.status} ${r.statusText}`.trim() };
    }
    const j: unknown = await r.json();
    if (!Array.isArray(j)) {
      return { ok: false, reason: 'Тело ответа не JSON-массив (ожидается список целей CDP)' };
    }
    return { ok: true };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const msg = e instanceof Error ? e.message : String(e);
    if (name === 'AbortError') {
      return { ok: false, reason: `Таймаут ${timeoutMs} мс (${url})` };
    }
    return { ok: false, reason: msg };
  }
}

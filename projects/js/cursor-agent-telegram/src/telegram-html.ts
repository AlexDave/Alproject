/**
 * Разметка для Telegram parse_mode HTML (см. https://core.telegram.org/bots/api#html-style).
 */

export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Разделитель абзацев в теле саммари (idle и после переключения агента). */
const PARA_SEP = '\n\n<i>────────────────</i>\n\n';

/** Заголовок блока после переключения агента. */
export const AFTER_SWITCH_SECTION_TITLE = 'Последний итог в чате';

/**
 * Общее тело сообщения: двойные переносы строк → абзацы с разделителем {@link PARA_SEP},
 * одинарные → `br`.
 */
export function formatSummaryBodyHtml(summaryPlain: string): string {
  const esc = escapeTelegramHtml;
  const raw = (summaryPlain || '').trim() || '—';
  const paras = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length > 0) {
    return paras.map((p) => esc(p).replace(/\n/g, '<br/>')).join(PARA_SEP);
  }
  return esc(raw).replace(/\n/g, '<br/>');
}

/**
 * Idle-уведомление «✅ Готово»: метка агента и тело через {@link formatSummaryBodyHtml} (без отдельной строки-подписи «план»).
 */
export function formatIdleDoneNotificationHtml(agentLabel: string, summaryPlain: string): string {
  const esc = escapeTelegramHtml;
  const label = esc((agentLabel || '').trim() || 'Agent');
  const body = formatSummaryBodyHtml(summaryPlain);
  return `<b>✅ Готово</b> · <i>${label}</i>\n\n${body}`;
}

/**
 * Legacy «Состояние агента»: один заголовок + весь текст с переносами как `br` (без абзацных разделителей).
 */
export function formatLegacyStateNotificationHtml(bodyPlain: string): string {
  const esc = escapeTelegramHtml;
  const formatted = esc(bodyPlain).replace(/\n/g, '<br/>');
  return `<b>📋 Состояние агента</b>\n\n${formatted}`;
}

/** После переключения агента в Telegram: метка агента + {@link AFTER_SWITCH_SECTION_TITLE}. */
export function formatAfterSwitchHtml(agentLabel: string, summaryPlain: string): string {
  const esc = escapeTelegramHtml;
  const label = esc((agentLabel || '').trim() || 'Agent');
  const body = formatSummaryBodyHtml(summaryPlain);
  return `<b>Активный агент</b> · <i>${label}</i>\n\n<b>${AFTER_SWITCH_SECTION_TITLE}</b>\n\n${body}`;
}

/** Уведомление об ошибке подключения CDP / снимка (единый стиль с остальными HTML-сообщениями). */
export function formatCdpErrorNotificationHtml(errorPlain: string): string {
  return `<b>⚠️ Ошибка CDP</b>\n\n${escapeTelegramHtml(errorPlain)}`;
}

export function formatAgentsStateHtml(
  agents: Array<{ agentLabel: string; isActive?: boolean; previewText?: string }>,
): string {
  if (agents.length === 0) {
    return '<b>Состояние</b>\n\n<i>Агенты не найдены в интерфейсе Cursor.</i>';
  }
  const esc = escapeTelegramHtml;
  const lines = agents.map((a) => {
    const mark = a.isActive ? '★ ' : '· ';
    const prev = (a.previewText || '').trim();
    const prevShort = prev.length > 140 ? `${prev.slice(0, 137)}…` : prev;
    if (prevShort) {
      return `${mark}<b>${esc(a.agentLabel)}</b>\n${esc(prevShort)}`;
    }
    return `${mark}<b>${esc(a.agentLabel)}</b>`;
  });
  return `<b>Состояние агентов</b>\n\n${lines.join('\n\n')}`;
}

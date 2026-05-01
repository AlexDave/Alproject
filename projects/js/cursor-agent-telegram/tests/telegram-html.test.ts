import { describe, expect, it } from 'vitest';
import {
  AFTER_SWITCH_SECTION_TITLE,
  escapeTelegramHtml,
  formatAfterSwitchHtml,
  formatAgentsStateHtml,
  formatCdpErrorNotificationHtml,
  formatIdleDoneNotificationHtml,
  formatLegacyStateNotificationHtml,
  formatSummaryBodyHtml,
} from '../src/telegram-html.js';

describe('escapeTelegramHtml', () => {
  it('экранирует &, <, >', () => {
    expect(escapeTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });
});

describe('formatSummaryBodyHtml', () => {
  it('соединяет абзацы разделителем и переносы строк в br', () => {
    const html = formatSummaryBodyHtml('A\nстрока\n\nB');
    expect(html).toContain('A<br/>строка');
    expect(html).toContain('────────────────');
    expect(html).toContain('B');
  });
});

describe('formatCdpErrorNotificationHtml', () => {
  it('заголовок и экранирование текста ошибки', () => {
    const html = formatCdpErrorNotificationHtml('bad <tag>');
    expect(html).toContain('<b>⚠️ Ошибка CDP</b>');
    expect(html).toContain('&lt;tag&gt;');
  });
});

describe('formatIdleDoneNotificationHtml', () => {
  it('делает заголовок и абзацы с разделителем без подписи «план»', () => {
    const html = formatIdleDoneNotificationHtml('Agent-1', 'Первый блок:\n• пункт\n\nВторой блок.');
    expect(html).toContain('<b>✅ Готово</b>');
    expect(html).toContain('<i>Agent-1</i>');
    expect(html).not.toContain('План или итог из чата');
    expect(html).toContain('Первый блок:');
    expect(html).toContain('Второй блок.');
    expect(html).toContain('────────────────');
    expect(html).toMatch(/<br\/?>/);
  });

  it('экранирует угловые скобки в тексте', () => {
    const html = formatIdleDoneNotificationHtml('X', 'см. <script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('formatLegacyStateNotificationHtml', () => {
  it('оборачивает заголовок и переносы', () => {
    const html = formatLegacyStateNotificationHtml('строка1\nстрока2');
    expect(html).toContain('<b>📋 Состояние агента</b>');
    expect(html).toContain('строка1<br/>');
  });
});

describe('formatAfterSwitchHtml', () => {
  it('содержит метку агента и итог', () => {
    const html = formatAfterSwitchHtml('MyAgent', 'результат\n\nещё');
    expect(html).toContain('MyAgent');
    expect(html).toContain(`<b>${AFTER_SWITCH_SECTION_TITLE}</b>`);
    expect(html).toContain('результат');
  });
});

describe('formatAgentsStateHtml', () => {
  it('пустой список', () => {
    expect(formatAgentsStateHtml([])).toContain('не найдены');
  });

  it('активный помечен звездой в HTML-тексте', () => {
    const html = formatAgentsStateHtml([
      { agentLabel: 'A', isActive: true },
      { agentLabel: 'B', isActive: false },
    ]);
    expect(html).toContain('★');
    expect(html).toContain('A');
    expect(html).toContain('B');
  });
});

import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import type { AppConfig } from '../config.js';
import { CHAT_CONTAINER_STRATEGIES, CHAT_INPUT_STRATEGIES } from './chat-selectors.js';
import { SNAPSHOT_EVAL_LOGIC } from './snapshot-eval-logic.js';

let browser: Browser | null = null;

export async function connectBrowser(cdpUrl: string): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.connectOverCDP(cdpUrl);
  return browser;
}

export async function disconnectBrowser(): Promise<void> {
  try {
    if (browser) {
      await browser.close();
    }
  } catch {
    /* ignore */
  }
  browser = null;
}

async function pickCursorPage(pages: Page[], titleSub: string): Promise<Page | null> {
  const sub = titleSub.toLowerCase();
  const real = pages.filter((p) => {
    const u = p.url();
    if (!u) return true;
    if (u.startsWith('devtools://')) return false;
    if (u.startsWith('chrome-extension://')) return false;
    return true;
  });
  for (const p of real) {
    const t = (await p.title()).toLowerCase();
    if (t.includes(sub)) return p;
  }
  return real[0] ?? null;
}

export async function getAgentPage(config: AppConfig): Promise<Page> {
  const b = await connectBrowser(config.CDP_URL);
  const contexts = b.contexts();
  const pages: Page[] = [];
  for (const ctx of contexts) {
    pages.push(...ctx.pages());
  }
  const page = await pickCursorPage(pages, config.CURSOR_PAGE_TITLE_SUBSTRING);
  if (!page) {
    throw new Error(
      'Не найдено окно Cursor. Запустите Cursor с --remote-debugging-port=9222 и откройте проект.',
    );
  }
  return page;
}

/**
 * Снимок в странице: контейнер из CHAT_CONTAINER_STRATEGIES → обход [data-flat-index] (как CursorRemote),
 * иначе запасной скоринг по DOM.
 * Селекторы задаются в chat-selectors.ts; тело eval — snapshot-eval-logic.ts.
 */
const snapshotInPage = new Function(
  'max',
  `var CHAT_CONTAINERS = ${JSON.stringify([...CHAT_CONTAINER_STRATEGIES])};\n${SNAPSHOT_EVAL_LOGIC}`,
) as (max: number) => string;

/**
 * Доп. разрывы для редких склеек innerText (ничего не удаляет).
 */
export function postProcessSnapshotText(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n').trim();
  if (!s) return '';

  const breaks: Array<[RegExp, string]> = [
    [/([;)])(\s*>\s*(?:tsc|npm)\b)/gi, '$1\n$2'],
    [/(\))(\s*(?:cd|\$cd)\s+"[A-Za-z]:[\\/])/g, '$1\n$2'],
    [/([^\s\n])(\$cd\s+)/gi, '$1\n$2'],
    [/([^\n])(Ran command:)/gi, '$1\n\n$2'],
    [/([^\n])(Explored\d+\s+(?:search|file|codebase|folder)\b)/gi, '$1\n\n$2'],
    [/([a-zа-яё])(\d+s)([А-ЯЁA-Z])/gu, '$1\n$2\n$3'],
    [/(\.json)(HAS __name\b)/gi, '$1\n$2'],
    [/([^\n])(HAS __name\b)/g, '$1\n$2'],
    [/([^\n])(ok no __name\b)/g, '$1\n$2'],
    [/(ok no __name)(?=[А-ЯЁа-яё])/gu, '$1\n'],
    [/(HAS __name)(?=Updating\b)/g, '$1\n'],
    [/(\))(\s*&&\s*node\s+-e\s+)/g, '$1\n$2'],
    [/([^\n])([\w.-]+\.(?:tsx?|ts|js|mdc|md)[+-]\d+[+-]\d+)(\/\*\*)/g, '$1\n\n$2\n$3'],
    [/([^\n\*])(\/\*\*)/g, '$1\n$2'],
    [/(\*\/)([А-ЯЁа-яёA-Za-z])/g, '$1\n$2'],
    [/([^\n])(>\s*tsc\b)/gi, '$1\n$2'],
    [/([^\n])(>\s*npm\s)/gi, '$1\n$2'],
  ];

  for (const [re, rep] of breaks) {
    s = s.replace(re, rep);
  }

  return s.replace(/\n{4,}/g, '\n\n\n').trim();
}

export async function snapshotAgentText(page: Page, maxChars: number): Promise<string> {
  const max = Math.min(500_000, Math.max(0, Math.floor(maxChars)));
  try {
    const raw = await page.evaluate(snapshotInPage, max);
    const cleaned = postProcessSnapshotText(raw);
    if (cleaned.length <= max) return cleaned;
    return cleaned.slice(-max);
  } catch {
    // Autopilot-style resilience: keep relay alive even when DOM/eval internals drift.
    const fallback = await page.evaluate((limit: number) => {
      const txt = document.body?.innerText ?? document.body?.textContent ?? '';
      const t = (txt || '').trim();
      if (t.length <= limit) return t;
      return t.slice(-limit);
    }, max);
    const cleaned = postProcessSnapshotText(fallback);
    if (cleaned.length <= max) return cleaned;
    return cleaned.slice(-max);
  }
}

/**
 * Поле ввода: сначала auxiliary bar / composer (как CursorRemote), затем общий fallback.
 */
export async function sendInstruction(page: Page, text: string, sendMode: 'enter' | 'mod+enter'): Promise<void> {
  let used = false;
  for (const sel of CHAT_INPUT_STRATEGIES) {
    const loc = page.locator(sel).last();
    const n = await loc.count();
    if (n === 0) continue;
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) continue;
    try {
      await loc.click({ timeout: 5000 });
      await loc.fill(text);
      used = true;
      break;
    } catch {
      continue;
    }
  }

  if (!used) {
    const ce = page.locator('[contenteditable="true"]').last();
    await ce.waitFor({ state: 'visible', timeout: 15000 });
    await ce.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text, { delay: 5 });
  }

  if (sendMode === 'mod+enter') {
    await page.keyboard.press('Control+Enter');
  } else {
    await page.keyboard.press('Enter');
  }
}

export async function createNewAgentDialog(page: Page, label?: string): Promise<void> {
  const selectors = [
    'button:has-text("New Chat")',
    'button:has-text("New Agent")',
    'button:has-text("Новый чат")',
    'button:has-text("Новый агент")',
    '[aria-label*="New Chat"]',
    '[aria-label*="New Agent"]',
    '[aria-label*="Новый чат"]',
    '[aria-label*="Новый агент"]',
    '[data-testid*="new-chat"]',
    '[data-testid*="new-agent"]',
  ];

  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    const count = await loc.count().catch(() => 0);
    if (count === 0) continue;
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) continue;
    try {
      await loc.click({ timeout: 2500 });
      await page.waitForTimeout(250);
      return;
    } catch {
      /* try next selector */
    }
  }

  try {
    await page.keyboard.press('Control+Shift+P');
    await page.waitForTimeout(220);
    const text = label?.trim() ? `new chat ${label.trim()}` : 'new chat';
    await page.keyboard.type(text, { delay: 4 });
    await page.waitForTimeout(220);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    return;
  } catch {
    /* ignore and throw below */
  }

  throw new Error('Не удалось создать новый диалог в Cursor: не найдена кнопка/команда New Chat');
}

export type CursorAgentItem = {
  agentId: string;
  agentLabel: string;
  isActive: boolean;
  cursorDialogId?: string;
  previewText?: string;
};

type RawAgentCandidate = {
  label: string;
  isActive: boolean;
  cursorDialogId: string | null;
};

function isAgentLikeRawLabel(raw: string): boolean {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  const hasStats = /\+\d+\s*-\d+\s*\d+\s*files?/i.test(compact);
  const hasTime = /\b\d+\s*(m|h|d)\b/i.test(compact);
  const hasStatus =
    /(planning|next moves|edited|tokens|выполняю|план|токен|файл|безопасност|структура)/i.test(compact);
  const hasNewline = raw.includes('\n');
  return (hasStats && (hasTime || hasNewline)) || (hasNewline && hasStatus);
}

function normalizeAgentLabel(raw: string): string {
  const first = raw
    .split('\n')
    .map((x) => x.trim())
    .find(Boolean);
  let label = (first ?? raw).replace(/\s+/g, ' ').trim();
  label = label.replace(/^[^\p{L}\p{N}]+/gu, '').trim();
  label = label.replace(/\+\d+\s*-\d+\s*\d+\s*Files?$/i, '').trim();
  label = label.replace(/\b\d+\s*(m|h|d)\s*$/i, '').trim();
  label = label.replace(/\bnow$/i, '').trim();
  return label;
}

function extractPreviewText(raw: string): string {
  const lines = raw
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  if (lines.length < 2) return '';
  return lines[1] ?? '';
}

async function collectRawAgentCandidates(page: Page): Promise<RawAgentCandidate[]> {
  const evalFn = new Function(`
    var roots = [
      '#workbench\\\\.parts\\\\.sidebar',
      '#workbench\\\\.parts\\\\.auxiliarybar',
      '#workbench\\\\.parts\\\\.panel',
      '.pane-body',
      '.monaco-scrollable-element',
      '[class*="composer"]',
      '[class*="chat"]',
      '[class*="agent"]',
    ];
    var roleSelectors = [
      '[role="tab"]',
      '[role="treeitem"]',
      '[role="listitem"]',
      '[role="button"]',
      '.monaco-list-row',
      '.monaco-tl-row',
      '[class*="chat-item"]',
      '[class*="agent-item"]',
    ];
    var items = [];
    var collect = function(root) {
      for (var r = 0; r < roleSelectors.length; r++) {
        var nodes = root.querySelectorAll(roleSelectors[r]);
        for (var n = 0; n < nodes.length; n++) {
          var el = nodes[n];
          var labelRaw = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '';
          var label = labelRaw.replace(/\\s+/g, ' ').trim();
          if (!label) continue;
          var className = ((el.className || '') + '').toLowerCase();
          var isActive =
            el.getAttribute('aria-selected') === 'true' ||
            el.getAttribute('aria-current') === 'true' ||
            className.indexOf('active') >= 0 ||
            className.indexOf('selected') >= 0;
          var cursorDialogId =
            el.getAttribute('data-id') ||
            el.getAttribute('data-dialog-id') ||
            el.getAttribute('data-key') ||
            el.id ||
            null;
          items.push({ label: label, isActive: isActive, cursorDialogId: cursorDialogId });
        }
      }
    };
    for (var i = 0; i < roots.length; i++) {
      var root = null;
      try { root = document.querySelector(roots[i]); } catch (e) { root = null; }
      if (root) collect(root);
    }
    if (items.length === 0) collect(document);
    var bodyText = (document.body && document.body.innerText) ? document.body.innerText : '';
    if (bodyText) {
      var lines = bodyText
        .split('\\n')
        .map(function(x){ return (x || '').trim(); })
        .filter(Boolean);
      var agentsIndex = lines.findIndex(function(x){ return x.toLowerCase() === 'agents'; });
      if (agentsIndex >= 0) {
        var isTime = function(x){ return /^\\d+\\s*(m|h|d)$/i.test(x); };
        var isJunk = function(x){
          var low = x.toLowerCase();
          if (!low) return true;
          if (low === 'agents' || low === 'archive all' || low === 'new agent') return true;
          if (/^\\+\\d+$/.test(low) || /^-\\d+$/.test(low)) return true;
          if (/^\\d+\\s*files?$/.test(low)) return true;
          if (low === '·') return true;
          return false;
        };
        var isSubtitle = function(x){
          var t = (x || '').trim();
          if (!t) return false;
          if (/^(edited|editing)\\b/i.test(t)) return true;
          if (/\\b(planning|next moves|executing|running)\\b/i.test(t)) return true;
          if (/\\.(ts|tsx|js|jsx|css|md|json)\\b/i.test(t) && t.indexOf(',') >= 0) return true;
          return false;
        };
          var seen = {};
        for (var i = agentsIndex + 1; i < Math.min(lines.length, agentsIndex + 120); i++) {
          var title = lines[i];
          if (isJunk(title)) continue;
          var hasNearTime = false;
          var hasNow = false;
          for (var j = i + 1; j < Math.min(lines.length, i + 7); j++) {
            if (isTime(lines[j])) { hasNearTime = true; }
            if ((lines[j] || '').toLowerCase() === 'now') hasNow = true;
          }
          if (!hasNearTime && !hasNow) continue;
          if (isSubtitle(title)) {
            for (var k = i - 1; k >= Math.max(agentsIndex + 1, i - 3); k--) {
              if (!isJunk(lines[k]) && !isSubtitle(lines[k])) {
                title = lines[k];
                break;
              }
            }
          }
          var key = title.toLowerCase();
          if (seen[key]) continue;
          seen[key] = true;
          var subtitle = '';
          for (var s = i + 1; s < Math.min(lines.length, i + 4); s++) {
            if (isJunk(lines[s]) || isTime(lines[s]) || isSubtitle(lines[s])) continue;
            subtitle = lines[s] || '';
            break;
          }
          items.push({
            label: subtitle ? (title + '\\n' + subtitle) : title,
            isActive: hasNow,
            cursorDialogId: 'text-agent-' + i
          });
        }
      }
    }
    return items;
  `) as () => RawAgentCandidate[];
  return page.evaluate(evalFn);
}

function slugifyAgentId(label: string): string {
  const lowered = label.toLowerCase().trim();
  const ascii = lowered.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii) return ascii;

  // Для не-ASCII названий (например, кириллицы) создаем стабильный id по хэшу,
  // иначе все такие диалоги схлопываются в один "agent".
  let h = 0;
  for (let i = 0; i < lowered.length; i++) h = (Math.imul(31, h) + lowered.charCodeAt(i)) | 0;
  return `agent-${Math.abs(h).toString(36)}`;
}

function isTextFallbackDialogId(cursorDialogId: string | null | undefined): boolean {
  return (cursorDialogId ?? '').startsWith('text-agent-');
}

function hasStableDialogId(cursorDialogId: string | null | undefined): boolean {
  if (!cursorDialogId) return false;
  if (isTextFallbackDialogId(cursorDialogId)) return false;
  // Частые не-чатовые id из Explorer/Terminal/Cursor UI.
  if (/^(list_id_|compressed-explorer_|terminal-|problems-|outline-|timeline-)/i.test(cursorDialogId)) {
    return false;
  }
  return true;
}

/**
 * Пытается вытащить список активных диалогов/агентов из DOM Cursor.
 * Это эвристика: предпочитаем элементы tab/tree/list внутри боковых панелей.
 */
export async function listCursorAgents(page: Page): Promise<CursorAgentItem[]> {
  const raw = await collectRawAgentCandidates(page);
  const textAgents = raw
    .filter((x) => isTextFallbackDialogId(x.cursorDialogId))
    .filter((x) => {
      const label = normalizeAgentLabel(x.label ?? '');
      const lower = label.toLowerCase();
      const words = label.split(/\s+/).filter(Boolean);
      if (!label) return false;
      if (/^\d+\s*(m|h|d)$/i.test(lower)) return false;
      if (lower === 'now') return false;
      if (label.length < 4) return false;
      if (label.length > 80) return false;
      if (words.length > 8) return false;
      if (/[,:;]\s/.test(label)) return false;
      if (/[.!?]$/.test(label)) return false;
      if (/^(принял|сделано|проверил|готово)\b/i.test(lower)) return false;
      return true;
    });
  const agentLike = raw.filter((x) => isAgentLikeRawLabel(x.label));
  // Приоритет — реальные элементы списка диалогов из DOM (со стабильным id),
  // а эвристики bodyText только как fallback.
  const stableDomDialogs = raw.filter((x) => hasStableDialogId(x.cursorDialogId));
  const activeDomLabels = new Set(
    stableDomDialogs
      .filter((x) => x.isActive)
      .map((x) => normalizeAgentLabel(x.label ?? ""))
      .filter(Boolean),
  );
  const nonTextAgentLike = agentLike.filter((x) => !isTextFallbackDialogId(x.cursorDialogId));
  const effectiveRaw =
    textAgents.length > 0
      ? textAgents
      : stableDomDialogs.length > 0
      ? stableDomDialogs
      : nonTextAgentLike.length > 0
      ? nonTextAgentLike
      : agentLike.length > 0
        ? agentLike
        : [];

  const uniq = new Map<string, CursorAgentItem>();
  for (const item of effectiveRaw) {
    const label = normalizeAgentLabel(item.label ?? '');
    if (!label) continue;
    if (label.length > 220) continue;
    const lowered = label.toLowerCase();
    if (
      lowered.includes('terminal') ||
      lowered.includes('explorer') ||
      lowered.includes('search') ||
      lowered.includes('source control') ||
      lowered.includes('extensions') ||
      lowered === 'agents'
    ) {
      continue;
    }
    const baseId = slugifyAgentId(label);
    // Для bodyText fallback id "text-agent-N" меняется от сдвига строк.
    // Чтобы не плодить "новых агентов" и не терять историю, делаем id стабильным по label.
    const id =
      item.cursorDialogId && !isTextFallbackDialogId(item.cursorDialogId)
        ? `${baseId}-${slugifyAgentId(item.cursorDialogId)}`
        : baseId;
    const isActiveCandidate = !!item.isActive || activeDomLabels.has(label);
    const prev = uniq.get(id);
    if (!prev) {
      uniq.set(id, {
        agentId: id,
        agentLabel: label,
        isActive: isActiveCandidate,
        cursorDialogId: item.cursorDialogId ?? undefined,
        previewText: extractPreviewText(item.label ?? ''),
      });
    } else if (isActiveCandidate) {
      uniq.set(id, {
        ...prev,
        isActive: true,
        previewText: prev.previewText || extractPreviewText(item.label ?? ''),
      });
    }
  }
  const result = [...uniq.values()];
  if (result.length > 0 && !result.some((x) => x.isActive)) {
    result[0] = { ...result[0], isActive: true };
  }
  return result;
}

export async function debugListCursorAgentCandidates(page: Page): Promise<RawAgentCandidate[]> {
  return collectRawAgentCandidates(page);
}

export async function switchAgent(page: Page, target: { agentId?: string; agentLabel?: string }): Promise<boolean> {
  const targetLabel = (target.agentLabel ?? '').trim();
  if (!targetLabel) return false;
  const escapedLabel = targetLabel.replace(/"/g, '\\"');
  const shortLabel = targetLabel.length > 18 ? targetLabel.slice(0, 18).trim() : targetLabel;
  const escapedShort = shortLabel.replace(/"/g, '\\"');
  const tinyLabel = targetLabel.length > 10 ? targetLabel.slice(0, 10).trim() : targetLabel;
  const escapedTiny = tinyLabel.replace(/"/g, '\\"');
  const words = targetLabel.split(/\s+/).filter(Boolean);
  const firstWord = (words[0] ?? '').trim();
  const twoWords = words.slice(0, 2).join(' ').trim();
  const escapedFirstWord = firstWord.replace(/"/g, '\\"');
  const escapedTwoWords = twoWords.replace(/"/g, '\\"');
  const selectors = [
    `.monaco-list-row:has-text("${escapedLabel}")`,
    `[role="treeitem"]:has-text("${escapedLabel}")`,
    `[role="listitem"]:has-text("${escapedLabel}")`,
    `button:has-text("${escapedLabel}")`,
    `text="${escapedLabel}"`,
    `.monaco-list-row:has-text("${escapedShort}")`,
    `[role="treeitem"]:has-text("${escapedShort}")`,
    `[role="listitem"]:has-text("${escapedShort}")`,
    `button:has-text("${escapedShort}")`,
    `text="${escapedShort}"`,
    `.monaco-list-row:has-text("${escapedTiny}")`,
    `[role="treeitem"]:has-text("${escapedTiny}")`,
    `[role="listitem"]:has-text("${escapedTiny}")`,
    `button:has-text("${escapedTiny}")`,
    `text="${escapedTiny}"`,
    ...(escapedTwoWords ? [`[role="treeitem"]:has-text("${escapedTwoWords}")`, `button:has-text("${escapedTwoWords}")`] : []),
    ...(escapedFirstWord ? [`[role="treeitem"]:has-text("${escapedFirstWord}")`, `button:has-text("${escapedFirstWord}")`] : []),
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      const count = await loc.count();
      if (count === 0) continue;
      const visible = await loc.isVisible().catch(() => false);
      if (!visible) continue;
      await loc.click({ timeout: 2500 });
      await page.waitForTimeout(250);
      return true;
    } catch {
      continue;
    }
  }

  // Последний fallback: кликаем по наиболее подходящему видимому элементу в DOM.
  try {
    const clicked = await page.evaluate((label) => {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const target = normalize(label);
      const parts = target.split(' ').filter(Boolean);
      const first = parts[0] ?? '';
      const two = parts.slice(0, 2).join(' ');
      const all = Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"],[role="listitem"],button,.monaco-list-row'));
      const visible = all.filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const score = (el: HTMLElement): number => {
        const raw = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '';
        const txt = normalize(raw);
        if (!txt) return -1;
        if (txt === target) return 100;
        if (txt.includes(target)) return 90;
        if (two && txt.includes(two)) return 70;
        if (first && txt.includes(first)) return 50;
        return -1;
      };
      let best: HTMLElement | null = null;
      let bestScore = -1;
      for (const el of visible) {
        const s = score(el);
        if (s > bestScore) {
          best = el;
          bestScore = s;
        }
      }
      if (!best || bestScore < 0) return false;
      best.click();
      return true;
    }, targetLabel);
    if (clicked) {
      await page.waitForTimeout(250);
      return true;
    }
  } catch {
    /* ignore */
  }

  // Агрессивный fallback: поиск любого видимого узла слева с текстом цели.
  try {
    const clicked = await page.evaluate((label) => {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const target = normalize(label);
      const parts = target.split(' ').filter(Boolean);
      const first = parts[0] ?? '';
      const two = parts.slice(0, 2).join(' ');
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('div,span,a,button,[role]'));
      const candidates: Array<{ el: HTMLElement; score: number }> = [];
      for (const el of nodes) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 14) continue;
        if (rect.left > Math.min(window.innerWidth * 0.45, 520)) continue; // только левая область (список агентов)
        const txt = normalize(el.textContent || '');
        if (!txt) continue;
        let score = -1;
        if (txt === target) score = 120;
        else if (txt.includes(target)) score = 100;
        else if (two && txt.includes(two)) score = 80;
        else if (first && txt.includes(first)) score = 60;
        if (score < 0) continue;
        if ((el.closest('button,[role="treeitem"],[role="listitem"],.monaco-list-row') ?? null) !== null) score += 20;
        candidates.push({ el, score });
      }
      if (candidates.length === 0) return false;
      candidates.sort((a, b) => b.score - a.score);
      const targetEl = candidates[0].el.closest<HTMLElement>('button,[role="treeitem"],[role="listitem"],.monaco-list-row') ?? candidates[0].el;
      targetEl.click();
      return true;
    }, targetLabel);
    if (clicked) {
      await page.waitForTimeout(300);
      return true;
    }
  } catch {
    /* ignore */
  }

  // Fallback через поиск по агентам (если есть поле Search Agents).
  try {
    const searchSelectors = [
      'input[placeholder*="Search Agents"]',
      'input[placeholder*="Search agents"]',
      'input[aria-label*="Search Agents"]',
      'input[aria-label*="Search agents"]',
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
    ];
    for (const sel of searchSelectors) {
      const loc = page.locator(sel).first();
      const count = await loc.count().catch(() => 0);
      if (count === 0) continue;
      const visible = await loc.isVisible().catch(() => false);
      if (!visible) continue;
      await loc.click({ timeout: 2000 });
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.type(targetLabel, { delay: 5 });
      const pickSelectors = [
        `[role="treeitem"]:has-text("${escapedLabel}")`,
        `[role="treeitem"]:has-text("${escapedShort}")`,
        `[role="treeitem"]:has-text("${escapedTiny}")`,
        `[role="listitem"]:has-text("${escapedLabel}")`,
        `[role="listitem"]:has-text("${escapedShort}")`,
      ];
      let picked = false;
      for (const pickSel of pickSelectors) {
        const pick = page.locator(pickSel).first();
        const pickCount = await pick.count().catch(() => 0);
        if (pickCount === 0) continue;
        const pickVisible = await pick.isVisible().catch(() => false);
        if (!pickVisible) continue;
        await pick.click({ timeout: 1500 }).catch(() => {});
        picked = true;
        break;
      }
      if (!picked) {
        await page.keyboard.press('ArrowDown').catch(() => {});
      }
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Области DOM, где чаще всего переключатель Agent / Plan / Ask (см. доку Cursor Plan Mode). */
const COMPOSER_SCOPES = [
  '#workbench\\.parts\\.auxiliarybar',
  '[class*="composer-bar"]',
  '[class*="composer-panel"]',
  '[class*="interactive-session"]',
];

/** Дополнительные корни для поиска вкладки Agent (версии Cursor различаются). */
const COMPOSER_AGENT_EXTRA_SCOPES = [
  '[class*="pane-composite"]',
  '[class*="aichat"]',
  '[class*="ai-chat"]',
  '[class*="AgentChat"]',
];

function allComposerAgentScopes(): readonly string[] {
  return [...COMPOSER_SCOPES, ...COMPOSER_AGENT_EXTRA_SCOPES];
}

/** Кандидаты вкладки/кнопки режима Plan (не кликать первый попавшийся по всему окну без скоупа — ложное срабатывание). */
const PLAN_TAB_SELECTORS = [
  '[role="tab"]:has-text("Plan")',
  'button[role="tab"]:has-text("Plan")',
  '[role="tab"]:has-text("План")',
  '[role="radio"]:has-text("Plan")',
  '[role="radio"]:has-text("План")',
  'button:has-text("Plan")',
  'button:has-text("План")',
  '[aria-label*="Plan"][role="tab"]',
  '[aria-label*="Plan"][role="button"]',
  '[data-testid*="plan"]',
];

async function focusComposerInput(page: Page): Promise<boolean> {
  for (const sel of CHAT_INPUT_STRATEGIES) {
    try {
      const loc = page.locator(sel).last();
      if ((await loc.count()) === 0) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.click({ timeout: 4500 });
      return true;
    } catch {
      continue;
    }
  }
  try {
    const ce = page.locator('[contenteditable="true"]').last();
    await ce.waitFor({ state: 'visible', timeout: 9000 });
    await ce.click();
    return true;
  } catch {
    return false;
  }
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Подписи «таблетки» текущего режима в новом UI Composer (dropdown вместо вкладок). */
const COMPOSER_MODE_PILL_NAME_RE = /^(Agent|Plan|Planning|Ask|Debug|План)$/i;

/** Сколько ключевых слов режима (Agent / Plan / Ask / Debug) есть в тексте меню — для отличия от меню моделей. */
function composerModeKeywordScore(txt: string): number {
  const t = txt.toLowerCase();
  let s = 0;
  if (/\bagent\b/i.test(t)) s++;
  if (/\bplan\b|\bплан\b/i.test(t)) s++;
  if (/\bask\b/i.test(t)) s++;
  if (/\bdebug\b/i.test(t)) s++;
  return s;
}

/** Меню выбора режима композера: несколько режимов или явный пункт Plan (иногда в DOM только Plan+Agent). */
function looksLikeComposerModePickerMenu(txt: string): boolean {
  const t = txt.trim();
  if (composerModeKeywordScore(t) >= 2) return true;
  return composerModeKeywordScore(t) >= 1 && /\b(plan|план)\b/i.test(t);
}

/** Эвристика: выпадающий список моделей (GPT/Claude/Auto…), а не режим Agent/Plan. */
function isLikelyModelPickerMenu(txt: string): boolean {
  const t = txt.toLowerCase();
  const modeScore = composerModeKeywordScore(txt);
  if (modeScore >= 3) return false;
  if (/gpt-\d|gpt-4|gpt-5|claude-|claude\s|anthropic|openai|recommended models|\bopus\b|\bsonnet\b/i.test(t))
    return true;
  if (/^auto\b|\b∞\s*auto/i.test(t.trim()) && modeScore <= 1) return true;
  return false;
}

/**
 * Клик по пункту выпадающего меню режима композера (Agent / Plan / Ask / Debug).
 * Не использует «голый» поиск по всей странице первым — иначе можно попасть в меню моделей с пунктом «Agent».
 */
async function clickComposerModeMenuItem(page: Page, mode: string): Promise<boolean> {
  const namePatterns: RegExp[] =
    mode === 'Plan'
      ? [/^Plan$/i, /^План$/i]
      : [new RegExp(`^${escapeRegexLiteral(mode)}$`, 'i')];

  await page.waitForTimeout(220);

  const menuRoots = page.locator('[role="menu"], [role="listbox"]');
  const mn = await menuRoots.count();

  type Ranked = { idx: number; score: number };
  const ranked: Ranked[] = [];
  for (let i = 0; i < mn; i++) {
    const menu = menuRoots.nth(i);
    if (!(await menu.isVisible().catch(() => false))) continue;
    const txt = await menu.innerText().catch(() => '');
    if (!looksLikeComposerModePickerMenu(txt)) continue;
    if (isLikelyModelPickerMenu(txt)) continue;
    ranked.push({ idx: i, score: composerModeKeywordScore(txt) });
  }
  ranked.sort((a, b) => b.score - a.score);

  const tryClickInMenu = async (menu: Locator): Promise<boolean> => {
    for (const nameRe of namePatterns) {
      for (const role of ['menuitem', 'menuitemradio', 'option'] as const) {
        try {
          const item = menu.getByRole(role, { name: nameRe }).first();
          if ((await item.count()) === 0) continue;
          if (!(await item.isVisible().catch(() => false))) continue;
          await item.scrollIntoViewIfNeeded().catch(() => {});
          await item.click({ timeout: 3000 });
          await page.waitForTimeout(380);
          await page.keyboard.press('Escape').catch(() => {});
          return true;
        } catch {
          /* next */
        }
      }
    }
    /** Резерв: подпись «Plan» с префиксом (иконка, чекмарк). */
    if (mode === 'Plan') {
      for (const role of ['menuitem', 'menuitemradio', 'option'] as const) {
        try {
          const loose = menu.getByRole(role, { name: /\b(plan|план)\b/i }).first();
          if ((await loose.count()) === 0) continue;
          if (!(await loose.isVisible().catch(() => false))) continue;
          await loose.scrollIntoViewIfNeeded().catch(() => {});
          await loose.click({ timeout: 3000 });
          await page.waitForTimeout(380);
          await page.keyboard.press('Escape').catch(() => {});
          return true;
        } catch {
          /* next */
        }
      }
    }
    return false;
  };

  for (const { idx } of ranked) {
    const menu = menuRoots.nth(idx);
    if (await tryClickInMenu(menu)) return true;
  }

  for (let i = mn - 1; i >= 0; i--) {
    const menu = menuRoots.nth(i);
    if (!(await menu.isVisible().catch(() => false))) continue;
    const txt = await menu.innerText().catch(() => '');
    if (isLikelyModelPickerMenu(txt)) continue;
    if (await tryClickInMenu(menu)) return true;
  }

  for (const nameRe of namePatterns) {
    for (const role of ['menuitem', 'menuitemradio', 'option'] as const) {
      try {
        const items = page.getByRole(role, { name: nameRe });
        const n = await items.count();
        if (n < 1) continue;
        const item = items.first();
        if (!(await item.isVisible().catch(() => false))) continue;
        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({ timeout: 3000 });
        await page.waitForTimeout(380);
        await page.keyboard.press('Escape').catch(() => {});
        return true;
      } catch {
        /* next */
      }
    }
  }

  if (mode === 'Plan') {
    for (const role of ['menuitem', 'menuitemradio', 'option'] as const) {
      try {
        const items = page.getByRole(role, { name: /\b(plan|план)\b/i });
        const n = await items.count();
        if (n < 1) continue;
        const item = items.first();
        if (!(await item.isVisible().catch(() => false))) continue;
        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({ timeout: 3000 });
        await page.waitForTimeout(380);
        await page.keyboard.press('Escape').catch(() => {});
        return true;
      } catch {
        /* next */
      }
    }
  }

  return false;
}

/**
 * Открывает выпадающий список режима композера (pill / combobox / aria-haspopup).
 * При нестабильном DOM задайте CURSOR_COMPOSER_MODE_TRIGGER_SELECTOR (CSS к триггеру).
 */
async function openComposerModeDropdown(page: Page, triggerSelector?: string | undefined): Promise<boolean> {
  const custom = triggerSelector?.trim();
  if (custom) {
    try {
      const loc = page.locator(custom).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 3500 });
        await page.waitForTimeout(450);
        return true;
      }
    } catch {
      /* fall through */
    }
  }

  for (const root of allComposerAgentScopes()) {
    const scope = page.locator(root).first();
    if ((await scope.count()) === 0) continue;
    try {
      const btns = scope.getByRole('button', { name: COMPOSER_MODE_PILL_NAME_RE });
      const n = await btns.count();
      for (let i = n - 1; i >= 0; i--) {
        const b = btns.nth(i);
        if (!(await b.isVisible().catch(() => false))) continue;
        await b.scrollIntoViewIfNeeded().catch(() => {});
        await b.click({ timeout: 3500 });
        await page.waitForTimeout(450);
        return true;
      }
    } catch {
      /* next scope */
    }
  }

  for (const root of allComposerAgentScopes()) {
    const scope = page.locator(root).first();
    if ((await scope.count()) === 0) continue;
    try {
      const expBtns = scope.locator('button[aria-expanded], [role="button"][aria-expanded]');
      const en = await expBtns.count();
      for (let i = en - 1; i >= 0; i--) {
        const b = expBtns.nth(i);
        if (!(await b.isVisible().catch(() => false))) continue;
        const hint =
          `${(await b.getAttribute('aria-label')) ?? ''} ${(await b.textContent()) ?? ''}`.toLowerCase();
        if (/model|^auto\b|gpt|claude|opus|sonnet/i.test(hint) && !/plan|agent|ask|debug|план/i.test(hint)) {
          continue;
        }
        await b.scrollIntoViewIfNeeded().catch(() => {});
        await b.click({ timeout: 3500 });
        await page.waitForTimeout(450);
        return true;
      }
    } catch {
      /* next scope */
    }
  }

  for (const root of allComposerAgentScopes()) {
    const scope = page.locator(root).first();
    if ((await scope.count()) === 0) continue;
    try {
      const triggers = scope.locator('[aria-haspopup="menu"], [aria-haspopup="listbox"]');
      const tn = await triggers.count();
      for (let i = tn - 1; i >= 0; i--) {
        const t = triggers.nth(i);
        if (!(await t.isVisible().catch(() => false))) continue;
        const hint =
          `${(await t.getAttribute('aria-label')) ?? ''} ${(await t.textContent()) ?? ''}`.toLowerCase();
        if (/model|^auto\b|gpt|claude|sonnet|opus/i.test(hint) && !/plan|agent|ask|debug|план/i.test(hint)) {
          continue;
        }
        await t.scrollIntoViewIfNeeded().catch(() => {});
        await t.click({ timeout: 3500 });
        await page.waitForTimeout(450);
        return true;
      }
    } catch {
      /* next scope */
    }
  }

  for (const root of allComposerAgentScopes()) {
    const scope = page.locator(root).first();
    if ((await scope.count()) === 0) continue;
    try {
      const combos = scope.locator('[role="combobox"]');
      const cn = await combos.count();
      for (let i = cn - 1; i >= 0; i--) {
        const c = combos.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        const txt = (await c.textContent())?.trim() ?? '';
        if (/^Auto\b/i.test(txt) || /^∞/.test(txt)) continue;
        if (!txt) continue;
        await c.scrollIntoViewIfNeeded().catch(() => {});
        await c.click({ timeout: 3500 });
        await page.waitForTimeout(450);
        return true;
      }
    } catch {
      /* next scope */
    }
  }

  try {
    const globalBtns = page.getByRole('button', { name: COMPOSER_MODE_PILL_NAME_RE });
    const gn = await globalBtns.count();
    for (let i = gn - 1; i >= 0; i--) {
      const b = globalBtns.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      await b.scrollIntoViewIfNeeded().catch(() => {});
      await b.click({ timeout: 3500 });
      await page.waitForTimeout(450);
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Открывает меню режима композера и выбирает пункт (новый UI: не табы, а dropdown).
 */
async function openComposerModeDropdownAndSelect(
  page: Page,
  mode: string,
  triggerSelector?: string | undefined,
): Promise<boolean> {
  const opened = await openComposerModeDropdown(page, triggerSelector);
  if (!opened) return false;
  const selected = await clickComposerModeMenuItem(page, mode);
  if (!selected) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(120);
  }
  return selected;
}

async function clickPlanInComposerScopes(page: Page): Promise<boolean> {
  for (const root of COMPOSER_SCOPES) {
    for (const sel of PLAN_TAB_SELECTORS) {
      try {
        const loc = page.locator(`${root} ${sel}`).first();
        if ((await loc.count()) === 0) continue;
        if (!(await loc.isVisible().catch(() => false))) continue;
        await loc.click({ timeout: 2200 });
        await page.waitForTimeout(300);
        return true;
      } catch {
        /* next */
      }
    }
  }
  return false;
}

/** Запасной поиск Plan вне скоупа (может попасть не в тот элемент — вызывается после скоупа). */
async function clickPlanAnywhere(page: Page): Promise<boolean> {
  for (const sel of PLAN_TAB_SELECTORS) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.click({ timeout: 2200 });
      await page.waitForTimeout(300);
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/**
 * Без выпадающего меню режим у поля чата переключается Shift+Tab по кругу — несколько попыток клика по Plan.
 * @see activateComposerPlanMode
 */
export const COMPOSER_PLAN_SHIFT_TAB_MAX_CYCLES = 6;

/**
 * Пытается включить Plan: меню режима → Plan (достаточно выбора пункта);
 * иначе горячие клавиши из .env → цикл Shift+Tab и клики по Plan.
 * Возвращает список человекочитаемых шагов (пустой = ничего не сработало).
 */
export async function activateComposerPlanMode(
  page: Page,
  envHotkeys?: string | undefined,
  composerModeTriggerSelector?: string | undefined,
): Promise<string[]> {
  const ensured = await ensureComposerMode(page, 'plan', {
    composerModeTriggerSelector,
    hotkeys: envHotkeys,
    maxShiftTabCycles: COMPOSER_PLAN_SHIFT_TAB_MAX_CYCLES,
  });
  return ensured.ok ? ensured.steps : [];
}

/** Интервал после каждого Shift+Tab в {@link activateComposerAgentMode} (ожидание обработки в Electron). */
export const COMPOSER_AGENT_SHIFT_TAB_GAP_MS = 280;

/** Сколько раз жмём Shift+Tab после перехода в Plan (цикл режимов у композера). */
export const COMPOSER_AGENT_SHIFT_TAB_COUNT = 3;

/**
 * Задержка перед коротким ответом в Telegram после успешного {@link activateComposerAgentMode}.
 * После последнего Shift+Tab внутри автоматизации уже отработана пауза {@link COMPOSER_AGENT_SHIFT_TAB_GAP_MS};
 * добавляем только буфер на применение режима и отрисовку (~один кадр + запас).
 */
export function composerAgentTelegramSettleDelayMs(): number {
  return Math.round(COMPOSER_AGENT_SHIFT_TAB_GAP_MS * 0.75) + 380;
}

/** Распознанный режим композера по подписи/сигналам в UI. */
export type ComposerModeKind = 'composer' | 'agent' | 'plan' | 'ask' | 'debug' | 'unknown';
export type ComposerModeTarget = Exclude<ComposerModeKind, 'unknown'>;

const INFINITY_RE = /\u221e|∞|infinity/i;

export function classifyComposerModeLabel(raw: string): ComposerModeKind {
  const t = raw.trim();
  if (!t) return 'unknown';
  if (INFINITY_RE.test(t)) return 'composer';
  if (/^план$/i.test(t) || /\bplan\b/i.test(t) || /planning/i.test(t)) return 'plan';
  if (/agent/i.test(t)) return 'agent';
  if (/\bask\b/i.test(t)) return 'ask';
  if (/debug/i.test(t)) return 'debug';
  if (/\bcomposer\b/i.test(t) && !/composer\.(plan|agent)/i.test(t)) return 'composer';
  return 'unknown';
}

export function classifyComposerModeSignals(blob: string): ComposerModeKind {
  const b = blob.toLowerCase();
  if (/план|\bplan\b|planning|\/plan|mode-plan|composer\.plan/.test(b)) return 'plan';
  if (INFINITY_RE.test(blob)) return 'composer';
  if (/\bcomposer\b/i.test(blob) && !/composer\.(plan|agent)/i.test(blob)) return 'composer';
  if (/\bagent\b|composer\.agent|hubot|composer-agent/.test(b)) return 'agent';
  if (/\bask\b|question(?![a-z])/i.test(b)) return 'ask';
  if (/debug|\bbug\b(?![a-z])/i.test(b)) return 'debug';
  return 'unknown';
}

function modeUiLabel(target: ComposerModeTarget): string {
  switch (target) {
    case 'plan':
      return 'Plan';
    case 'agent':
      return 'Agent';
    case 'ask':
      return 'Ask';
    case 'debug':
      return 'Debug';
    case 'composer':
      return 'Composer';
  }
}

function modeMatches(current: ComposerModeKind, target: ComposerModeTarget): boolean {
  if (target === 'composer') return current === 'composer';
  return current === target;
}

/**
 * Читает текущий режим без переключения: сначала по явной кнопке, затем по видимым контролам в зоне композера.
 */
export async function readComposerModeFromUi(
  page: Page,
  composerModeTriggerSelector?: string | undefined,
): Promise<{ label: string; kind: ComposerModeKind }> {
  const custom = composerModeTriggerSelector?.trim();
  if (custom) {
    const fromCustom = await page
      .evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const txt = (el.innerText || el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const label = (txt.split('\n')[0] || aria || '').trim();
        return label || null;
      }, custom)
      .catch(() => null);
    if (fromCustom) return { label: fromCustom, kind: classifyComposerModeLabel(fromCustom) };
  }

  const probe = await page
    .evaluate(() => {
      const roots = [
        '#workbench\\.parts\\.auxiliarybar',
        '[class*="composer-bar"]',
        '[class*="composer-panel"]',
        '[class*="interactive-session"]',
        '[class*="pane-composite"]',
        '[class*="aichat"]',
        '[class*="AgentChat"]',
      ];
      const labels: string[] = [];
      const push = (v: string) => {
        const s = (v || '').replace(/\s+/g, ' ').trim();
        if (!s) return;
        if (labels.includes(s)) return;
        labels.push(s);
      };
      for (const rootSel of roots) {
        const root = document.querySelector(rootSel);
        if (!root) continue;
        const nodes = root.querySelectorAll<HTMLElement>('button, [role="button"], [role="combobox"]');
        for (const el of Array.from(nodes)) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          push((el.innerText || el.textContent || '').split('\n')[0] || '');
          push(el.getAttribute('aria-label') || '');
          const cls = String(el.className || '');
          if (cls) push(cls);
          const href = el.querySelector('use')?.getAttribute('href') || el.querySelector('use')?.getAttribute('xlink:href') || '';
          if (href) push(href);
        }
      }
      return labels;
    })
    .catch(() => [] as string[]);

  for (const label of probe) {
    const kind = classifyComposerModeSignals(label);
    if (kind !== 'unknown') return { label, kind };
  }

  return {
    label:
      'переключатель режима не найден в DOM; укажите CURSOR_COMPOSER_MODE_TRIGGER_SELECTOR или обновите relay (панель композера при этом может быть открыта)',
    kind: 'unknown',
  };
}

/**
 * Единый способ установить режим композера:
 * 1) читаем текущий (DOM parser),
 * 2) пытаемся выбрать из dropdown,
 * 3) fallback: Shift+Tab-циклы с проверкой после каждого шага,
 * 4) fallback: hotkeys из .env.
 */
export async function ensureComposerMode(
  page: Page,
  target: ComposerModeTarget,
  opts?: {
    composerModeTriggerSelector?: string;
    hotkeys?: string;
    maxShiftTabCycles?: number;
  },
): Promise<{ ok: boolean; steps: string[]; mode: ComposerModeKind; label: string }> {
  const steps: string[] = [];
  const maxCycles = Math.max(1, opts?.maxShiftTabCycles ?? COMPOSER_PLAN_SHIFT_TAB_MAX_CYCLES);

  const read = async () => readComposerModeFromUi(page, opts?.composerModeTriggerSelector);
  const first = await read();
  if (modeMatches(first.kind, target)) {
    steps.push(`режим уже активен: ${first.kind}`);
    return { ok: true, steps, mode: first.kind, label: first.label };
  }

  if (await focusComposerInput(page)) steps.push('фокус в поле композера');
  await page.waitForTimeout(120);

  const targetLabel = modeUiLabel(target);
  if (await openComposerModeDropdownAndSelect(page, targetLabel, opts?.composerModeTriggerSelector)) {
    steps.push(`меню режима → ${targetLabel}`);
    const afterDropdown = await read();
    if (modeMatches(afterDropdown.kind, target)) {
      return { ok: true, steps, mode: afterDropdown.kind, label: afterDropdown.label };
    }
  }

  // Старый UI fallback для plan: прямой клик по кнопке Plan в панели.
  if (target === 'plan') {
    if (await clickPlanInComposerScopes(page)) {
      steps.push('клик по Plan в панели композера');
      const afterClick = await read();
      if (modeMatches(afterClick.kind, target)) {
        return { ok: true, steps, mode: afterClick.kind, label: afterClick.label };
      }
    }
    if (await clickPlanAnywhere(page)) {
      steps.push('клик по Plan (глобально)');
      const afterClick = await read();
      if (modeMatches(afterClick.kind, target)) {
        return { ok: true, steps, mode: afterClick.kind, label: afterClick.label };
      }
    }
  }

  if (await focusComposerInput(page)) steps.push('фокус в поле композера (перед Shift+Tab)');
  for (let i = 1; i <= maxCycles; i++) {
    try {
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(COMPOSER_AGENT_SHIFT_TAB_GAP_MS);
      const probe = await read();
      if (modeMatches(probe.kind, target)) {
        steps.push(`Shift+Tab ×${i}`);
        return { ok: true, steps, mode: probe.kind, label: probe.label };
      }
    } catch {
      /* ignore */
    }
  }

  const hk = opts?.hotkeys?.trim();
  if (hk && (await tryCursorPlanModeHotkeys(page, hk))) {
    steps.push(`горячие клавиши из .env: ${hk}`);
    const afterKeys = await read();
    if (modeMatches(afterKeys.kind, target)) {
      return { ok: true, steps, mode: afterKeys.kind, label: afterKeys.label };
    }
    return { ok: false, steps, mode: afterKeys.kind, label: afterKeys.label };
  }

  const final = await read();
  return { ok: false, steps, mode: final.kind, label: final.label };
}

/**
 * Включает режим Agent: сначала тот же сценарий, что «Плановый режим» (переход в Plan),
 * затем при фокусе в композере три раза Shift+Tab — цикл режимов у поля чата в Cursor (Plan → … → Agent).
 * Опционально в конце — CURSOR_AGENT_MODE_KEYS из .env.
 */
export async function activateComposerAgentMode(
  page: Page,
  envHotkeys?: string | undefined,
  composerModeTriggerSelector?: string | undefined,
  planModeEnvHotkeys?: string | undefined,
): Promise<string[]> {
  const steps: string[] = [];
  const ensured = await ensureComposerMode(page, 'agent', {
    composerModeTriggerSelector,
    hotkeys: envHotkeys || planModeEnvHotkeys,
    maxShiftTabCycles: Math.max(COMPOSER_PLAN_SHIFT_TAB_MAX_CYCLES, COMPOSER_AGENT_SHIFT_TAB_COUNT + 2),
  });
  steps.push(...ensured.steps);
  return ensured.ok ? steps : [];
}

const PLAN_BUILD_SCOPES = [
  '#workbench\\.parts\\.auxiliarybar',
  '#workbench\\.parts\\.editor',
  '[class*="composer"]',
  '[class*="plan"]',
  '.monaco-workbench',
];

const PLAN_BUILD_BUTTON_SELECTORS = [
  'button:has-text("Build")',
  '[role="button"]:has-text("Build")',
  'button:has-text("Собрать")',
];

async function clickPlanBuildButton(page: Page): Promise<boolean> {
  for (const root of PLAN_BUILD_SCOPES) {
    for (const sel of PLAN_BUILD_BUTTON_SELECTORS) {
      try {
        const loc = page.locator(`${root} ${sel}`).first();
        if ((await loc.count()) === 0) continue;
        if (!(await loc.isVisible().catch(() => false))) continue;
        await loc.click({ timeout: 2200 });
        await page.waitForTimeout(400);
        return true;
      } catch {
        /* next */
      }
    }
  }
  return false;
}

/**
 * Запускает сборку плана в Cursor: клик по кнопке Build или клавиши (по умолчанию Control+Enter после фокуса композера).
 */
export async function triggerCursorPlanBuild(page: Page, keysSpec?: string | undefined): Promise<string[]> {
  const steps: string[] = [];

  if (await clickPlanBuildButton(page)) {
    steps.push('клик по кнопке Build');
    return steps;
  }

  if (await focusComposerInput(page)) steps.push('фокус в поле композера');
  await page.waitForTimeout(160);

  const spec = keysSpec?.trim() || 'Control+Enter';
  if (await tryCursorPlanModeHotkeys(page, spec)) {
    steps.push(`Build плана: ${spec}`);
    return steps;
  }

  return [];
}

/**
 * Устаревшее имя: только глобальный клик по Plan.
 * @deprecated для бота используйте activateComposerPlanMode
 */
export async function toggleComposerPlanMode(page: Page): Promise<boolean> {
  return clickPlanAnywhere(page);
}

/**
 * Последовательность нажатий Playwright: сегменты через `|`, внутри сегмента модификаторы через `+`.
 * Пример: Control+Shift+KeyP или Shift+Tab|Enter
 */
export async function tryCursorPlanModeHotkeys(page: Page, spec: string): Promise<boolean> {
  const parts = spec
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  try {
    for (const p of parts) {
      await page.keyboard.press(p);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(200);
    return true;
  } catch {
    return false;
  }
}

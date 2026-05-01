/** Разделитель блоков снимка чата (совпадает с snapshot-eval-logic). */
export const SNAPSHOT_BLOCK_SEP = '\n\n---\n\n';

const EMPTY_HINT = '(пустой снимок — см. README, селекторы DOM)';

/** Если последний блок короче этого порога, к саммари добавляется предыдущий блок (основной текст ответа часто там). */
const MIN_LAST_MEANINGFUL_CHARS = 100;

/** Разделитель между двумя блоками в одном сообщении Telegram. */
const BLOCK_GLUE = '\n\n────────\n\n';

function clampChars(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  const sliceLen = Math.max(0, maxChars - 1);
  return `${s.slice(0, sliceLen)}…`;
}

function longestSegment(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Убирает артефакты вкладок редактора Cursor (path/file.ts+startLine-endLine), из‑за которых
 * в снимок попадает «склейка» с кодом без пробела.
 */
/**
 * Есть ли кодовая фраза завершения в последнем или предпоследнем блоке снимка (не во всей истории).
 */
/**
 * Ищет кодовую фразу в последних `tailBlockCount` блоках снимка (по умолчанию 8).
 * Раньше проверялись только 2 блока — после Build фраза часто оказывается глубже, чем короткий статусный хвост.
 */
export function tailBlocksContainPhrase(
  snap: string,
  phrase: string,
  tailBlockCount: number = 8,
): boolean {
  if (!phrase) return true;
  const trimmed = snap.trim();
  if (!trimmed) return false;
  const parts = trimmed.split(SNAPSHOT_BLOCK_SEP).map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  const n = Math.min(parts.length, Math.max(2, tailBlockCount));
  const tail = parts.slice(-n);
  return tail.some((block) => block.includes(phrase));
}

/**
 * Убирает кодовую фразу из текста для Telegram: точное совпадение, NBSP→пробел,
 * строки целиком из маркера, повторная очистка после нормализации.
 */
export function stripDonePhraseFromSummary(text: string, phrase: string): string {
  if (!phrase) return text;
  const p = phrase.replace(/\u00a0/g, ' ');
  let s = text.replace(/\u00a0/g, ' ');
  const stripPass = (raw: string): string => {
    let x = raw;
    while (x.includes(p)) {
      x = x.replace(p, '');
    }
    const lines = x.split('\n');
    return lines
      .filter((line) => line.trim() !== p)
      .join('\n');
  };
  s = stripPass(s);
  s = stripPass(s);
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

export function stripEditorTabPrefixes(text: string): string {
  let s = text;
  s = s.replace(/\b[\w./\\-]+\.(?:ts|tsx|js|mjs|cjs|jsx|json|md|css|vue|py)\+\d+-\d+/gi, '');
  s = s.replace(/;(?=\s*(?:import|export)\b)/g, ';\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Убирает хвост снимка с подсказками UI Cursor (Plan, View Plan, склейка с .plan.md и т.д.).
 */
export function stripTrailingCursorChrome(text: string): string {
  let t = text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
  // Склейка `.plan.md` с текстом без пробела — артефакт DOM, отрезаем от суффикса.
  const glued = t.match(/\.plan\.md(?=[^\s\n./])/i);
  if (glued?.index !== undefined && glued.index >= 48) {
    t = t.slice(0, glued.index).trim();
  }
  let cutAt = t.length;
  const markerRes = [/\bView\s+Plan\b/gi, /\bBuild\s+Ctrl/gi, /\d+\s+To-dos\b/gi];
  for (const re of markerRes) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      if (m.index >= 40 && m.index < cutAt) cutAt = m.index;
    }
  }
  if (cutAt < t.length) t = t.slice(0, cutAt).trim();
  const lines = t
    .split('\n')
    .filter((line) => !/^\s*(View\s+Plan|Auto\s*|Build\s+Ctrl)/i.test(line.trim()));
  t = lines.join('\n').trim();
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Текст для Telegram: то, что полезнее всего прочитать человеку.
 * Последний блок в DOM часто — короткая строка терминала/тула; тогда берём предыдущий блок или самый длинный из хвоста снимка.
 */
export function lastBlockSummary(snap: string, maxChars: number): string {
  const trimmed = snap.trim();
  if (!trimmed) return EMPTY_HINT;

  const parts = trimmed.split(SNAPSHOT_BLOCK_SEP).map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return EMPTY_HINT;

  const tail = parts.slice(-6);
  const last = tail[tail.length - 1]!;
  let body: string;

  if (parts.length === 1) {
    body = last;
  } else if (last.length < MIN_LAST_MEANINGFUL_CHARS) {
    const prev = tail.length >= 2 ? tail[tail.length - 2]! : '';
    body = prev ? `${prev}${BLOCK_GLUE}${last}` : last;
  } else {
    body = last;
  }

  // Оба хвостовых фрагмента короткие — вероятно только статусы; берём самый длинный из последних блоков.
  if (body.length < 90 && tail.length >= 3) {
    body = longestSegment(tail);
  }

  let cleaned = stripEditorTabPrefixes(body.trim());
  if (cleaned.length < 12 && body.length > 12) {
    cleaned = stripEditorTabPrefixes(longestSegment(parts));
  }
  if (!cleaned) return EMPTY_HINT;

  return clampChars(cleaned, maxChars);
}

/** UI Cursor («View Plan» у плана) в полном снимке — для кнопки Build до stripTrailingCursorChrome. */
export function snapshotImpliesPlanBuildButton(snap: string): boolean {
  return /\bView\s+Plan\b/i.test(snap);
}

/** Эвристика «текст похож на план» — для idle-кнопки «Выполнить план» и preferPlanIdleSummary. */
export function summaryLooksLikePlan(text: string): boolean {
  return looksLikePlanBlock(text);
}

function looksLikePlanBlock(text: string): boolean {
  const t = text.trim();
  if (/\bView\s+Plan\b/i.test(t)) return true;
  if (t.length < 32) return false;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  let numbered = 0;
  let bullets = 0;
  for (const line of lines) {
    if (/^\d+[\.\)]\s*\S/.test(line)) numbered++;
    if (/^[•\-\*]\s*\S/.test(line)) bullets++;
  }
  if (numbered >= 2 || bullets >= 2) return true;
  if (/\b(план|plan)\b/i.test(t) && lines.length >= 4) return true;
  if (/^#{1,3}\s*(plan|план)\b/im.test(lines[0] ?? '')) return true;
  return false;
}

/**
 * Для idle в Telegram: если в хвосте снимка есть блок, похожий на план (списки, заголовок Plan/План),
 * берём его целиком, а не короткий «итоговый» статус после него (терминал, тул).
 */
export function preferPlanIdleSummary(snap: string, maxChars: number): string {
  const trimmed = snap.trim();
  if (!trimmed) return EMPTY_HINT;
  const parts = trimmed.split(SNAPSHOT_BLOCK_SEP).map((p) => p.trim()).filter(Boolean);
  const scanDepth = Math.min(parts.length, 24);
  for (let offset = 0; offset < scanDepth; offset++) {
    const i = parts.length - 1 - offset;
    const block = parts[i]!;
    if (!looksLikePlanBlock(block)) continue;
    const cleaned = stripEditorTabPrefixes(block.trim());
    if (!cleaned) continue;
    return clampChars(cleaned, maxChars);
  }
  return lastBlockSummary(snap, maxChars);
}

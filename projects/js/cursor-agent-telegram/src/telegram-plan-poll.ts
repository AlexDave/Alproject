/** Извлечение вариантов для Telegram sendPoll из idle-саммари (план агента). */

const MAX_OPTION_LEN = 100;
const MAX_QUESTION_LEN = 300;
export const PLAN_POLL_MIN_OPTIONS = 2;
export const PLAN_POLL_MAX_OPTIONS = 12;

const POLL_REGISTRY_TTL_MS = 48 * 60 * 60 * 1000;

type RegistryEntry = { options: string[]; expiresAt: number };
const pollRegistry = new Map<string, RegistryEntry>();

function prunePollRegistry(): void {
  const now = Date.now();
  for (const [id, e] of pollRegistry) {
    if (e.expiresAt <= now) pollRegistry.delete(id);
  }
}

export function registerPlanPoll(pollId: string, options: readonly string[]): void {
  prunePollRegistry();
  pollRegistry.set(pollId, {
    options: [...options],
    expiresAt: Date.now() + POLL_REGISTRY_TTL_MS,
  });
}

/** Возвращает копию массива опций или undefined, если poll неизвестен или истёк TTL. */
export function getPlanPollOptions(pollId: string): string[] | undefined {
  prunePollRegistry();
  const e = pollRegistry.get(pollId);
  if (!e || e.expiresAt <= Date.now()) {
    pollRegistry.delete(pollId);
    return undefined;
  }
  return [...e.options];
}

function clampOption(s: string): string {
  const t = s.replace(/\u00a0/g, ' ').trim();
  if (t.length <= MAX_OPTION_LEN) return t;
  return `${t.slice(0, MAX_OPTION_LEN - 1)}…`;
}

function dedupeOptions(opts: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of opts) {
    const o = clampOption(raw);
    if (!o || seen.has(o)) continue;
    seen.add(o);
    out.push(o);
    if (out.length >= PLAN_POLL_MAX_OPTIONS) break;
  }
  return out;
}

function lineIsNumbered(line: string): RegExpMatchArray | null {
  return line.match(/^\d+[\.\)]\s*(.+)$/);
}

function lineIsBullet(line: string): RegExpMatchArray | null {
  return line.match(/^[•\-\*]\s*(.+)$/);
}

function extractOptionsFromLines(lines: readonly string[]): string[] {
  const numbered: string[] = [];
  const bullets: string[] = [];
  const withQuestionMark: string[] = [];

  for (const line of lines) {
    const n = lineIsNumbered(line);
    if (n) {
      numbered.push(n[1]!.trim());
      continue;
    }
    const b = lineIsBullet(line);
    if (b) {
      bullets.push(b[1]!.trim());
      continue;
    }
    if (/\?\s*$/.test(line) && line.length >= 4) withQuestionMark.push(line.trim());
  }

  if (numbered.length >= PLAN_POLL_MIN_OPTIONS) return dedupeOptions(numbered);
  if (bullets.length >= PLAN_POLL_MIN_OPTIONS) return dedupeOptions(bullets);
  if (withQuestionMark.length >= PLAN_POLL_MIN_OPTIONS) return dedupeOptions(withQuestionMark);

  const merged = dedupeOptions([...numbered, ...bullets]);
  if (merged.length >= PLAN_POLL_MIN_OPTIONS) return merged;

  return [];
}

/** Первая строка списка: нумерация, маркер или строка с ? в конце. */
function firstListLineIndex(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]!.trim();
    if (lineIsNumbered(L) || lineIsBullet(L)) return i;
    if (/\?\s*$/.test(L) && L.length >= 4) return i;
  }
  return -1;
}

function buildQuestionFromIntro(intro: string, defaultQuestion: string): string {
  const oneLine = intro.replace(/\s+/g, ' ').trim();
  if (!oneLine) return defaultQuestion;
  if (oneLine.length <= MAX_QUESTION_LEN) return oneLine;
  return `${oneLine.slice(0, MAX_QUESTION_LEN - 1)}…`;
}

export type PlanPollExtract = {
  question: string;
  options: string[];
};

/**
 * Если в саммари есть 2–12 распознанных варианта (нумерация, маркеры или строки с «?»),
 * возвращает текст вопроса и опции для sendPoll.
 */
export function extractPlanChoicesFromSummary(
  summary: string,
  defaultQuestion: string,
): PlanPollExtract | null {
  const text = summary.replace(/\r\n/g, '\n').trim();
  if (!text) return null;

  const rawLines = text.split('\n').map((l) => l.trim());
  const lines = rawLines.filter((l) => l.length > 0);

  const listStart = firstListLineIndex(lines);
  let intro = '';
  let listSlice = lines;

  if (listStart >= 0) {
    intro = lines.slice(0, listStart).join('\n').trim();
    listSlice = lines.slice(listStart);
  }

  const options = extractOptionsFromLines(listSlice);
  if (options.length < PLAN_POLL_MIN_OPTIONS || options.length > PLAN_POLL_MAX_OPTIONS) return null;

  const question = buildQuestionFromIntro(intro, defaultQuestion);

  return { question, options };
}

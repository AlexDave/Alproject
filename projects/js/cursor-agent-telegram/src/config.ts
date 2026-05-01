import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '..', '.env') });

function parseIntEnv(v: string | undefined, def: number): number {
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const schema = z
  .object({
    TELEGRAM_BOT_TOKEN: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().min(10).optional(),
    ),
    TELEGRAM_ALLOWED_USER_IDS: z
      .string()
      .optional()
      .transform((s) =>
        s
          ? s
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
              .map((x) => Number(x))
          : [],
      )
      .refine((a) => a.every((n) => Number.isFinite(n)), 'Некорректные id'),
    TELEGRAM_API_ROOT: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().url().optional(),
    ),
    TELEGRAM_PROXY_URL: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().url().optional(),
    ),
    HUB_URL: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().url().optional(),
    ),
    /** Опционально: публичный HTTPS портала (туннель). Ingest relay по-прежнему через HUB_URL. */
    HUB_PUBLIC_URL: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().url().optional(),
    ),
    HUB_INGEST_SECRET: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().min(8).optional(),
    ),
    HUB_CONTROL_SECRET: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().min(8).optional(),
    ),
    AGENT_ID: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().min(1).optional(),
    ),
    AGENT_LABEL: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : v),
      z.string().min(1).optional(),
    ),
    CDP_URL: z.string().url().optional(),
    CURSOR_PAGE_TITLE_SUBSTRING: z.string().optional(),
    POLL_INTERVAL_MS: z.string().optional(),
    MIN_NOTIFY_INTERVAL_MS: z.string().optional(),
    CONTINUE_PHRASE: z.string().optional(),
    SEND_MODIFIERS: z.enum(['enter', 'mod+enter']).optional(),
    SNAPSHOT_MAX_CHARS: z.string().optional(),
    TELEGRAM_NOTIFY_MODE: z.enum(['idle', 'legacy']).optional(),
    TELEGRAM_STABLE_MS: z.string().optional(),
    TELEGRAM_SUMMARY_MAX_CHARS: z.string().optional(),
    /** Если задана, idle-уведомление в Telegram только при наличии этой строки в хвостовых блоках снимка. */
    TELEGRAM_DONE_PHRASE: z.preprocess((v) => {
      if (v === undefined || v === '') return undefined;
      const t = String(v).trim();
      return t === '' ? undefined : t;
    }, z.string().min(1).optional()),
    /** Запасной ввод Plan: последовательность для Playwright keyboard.press, сегменты через | (например Control+Shift+KeyP). */
    CURSOR_PLAN_MODE_KEYS: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : String(v).trim() || undefined),
      z.string().min(1).optional(),
    ),
    /** Запасной ввод режима Agent в композере (сегменты через |), после клика по вкладке Agent. */
    CURSOR_AGENT_MODE_KEYS: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : String(v).trim() || undefined),
      z.string().min(1).optional(),
    ),
    /**
     * Один CSS-селектор триггера выпадающего меню режима композера (Agent / Plan / …), если авто-детект ломается на вашей сборке Cursor.
     */
    CURSOR_COMPOSER_MODE_TRIGGER_SELECTOR: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : String(v).trim() || undefined),
      z.string().min(1).optional(),
    ),
    /** Клавиши для «Build» плана в Cursor (по умолчанию Control+Enter). Сегменты через |. */
    CURSOR_PLAN_BUILD_KEYS: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : String(v).trim() || undefined),
      z.string().min(1).optional(),
    ),
    /** Отправлять ли опрос по распознанным из саммари вариантам (idle-уведомление): 0/false/off — выкл. */
    TELEGRAM_PLAN_POLL: z.preprocess((v) => {
      if (v === undefined || v === '') return true;
      const s = String(v).trim().toLowerCase();
      return !(s === '0' || s === 'false' || s === 'no' || s === 'off');
    }, z.boolean()),
    /** Текст вопроса опроса, если из саммари не извлечено короткое вступление (до 300 символов). */
    TELEGRAM_PLAN_POLL_DEFAULT_QUESTION: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : String(v).trim()),
      z.string().min(1).max(300).optional(),
    ),
    /** Сколько последних блоков снимка проверять на TELEGRAM_DONE_PHRASE (раньше было фиксированно 2). */
    TELEGRAM_DONE_PHRASE_TAIL_BLOCKS: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.TELEGRAM_BOT_TOKEN && !data.HUB_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_BOT_TOKEN'],
        message: 'Нужен TELEGRAM_BOT_TOKEN или HUB_URL',
      });
    }
    if (data.TELEGRAM_BOT_TOKEN && data.TELEGRAM_ALLOWED_USER_IDS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEGRAM_ALLOWED_USER_IDS'],
        message: 'С Telegram укажите TELEGRAM_ALLOWED_USER_IDS',
      });
    }
    if (data.HUB_URL && !data.HUB_INGEST_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HUB_INGEST_SECRET'],
        message: 'С HUB_URL укажите HUB_INGEST_SECRET (как в портале)',
      });
    }
  });

export type AppConfig = {
  TELEGRAM_BOT_TOKEN: string | undefined;
  TELEGRAM_ALLOWED_USER_IDS: number[];
  TELEGRAM_API_ROOT: string | undefined;
  TELEGRAM_PROXY_URL: string | undefined;
  HUB_URL: string | undefined;
  HUB_PUBLIC_URL: string | undefined;
  HUB_INGEST_SECRET: string | undefined;
  HUB_CONTROL_SECRET: string | undefined;
  AGENT_ID: string;
  AGENT_LABEL: string;
  CDP_URL: string;
  CURSOR_PAGE_TITLE_SUBSTRING: string;
  POLL_INTERVAL_MS: number;
  MIN_NOTIFY_INTERVAL_MS: number;
  CONTINUE_PHRASE: string;
  SEND_MODIFIERS: 'enter' | 'mod+enter';
  SNAPSHOT_MAX_CHARS: number;
  TELEGRAM_NOTIFY_MODE: 'idle' | 'legacy';
  TELEGRAM_STABLE_MS: number;
  TELEGRAM_SUMMARY_MAX_CHARS: number;
  TELEGRAM_DONE_PHRASE: string | undefined;
  CURSOR_PLAN_MODE_KEYS: string | undefined;
  CURSOR_AGENT_MODE_KEYS: string | undefined;
  /** CSS к кнопке/combobox, открывающему меню режима композера (dropdown UI). */
  CURSOR_COMPOSER_MODE_TRIGGER_SELECTOR: string | undefined;
  CURSOR_PLAN_BUILD_KEYS: string | undefined;
  TELEGRAM_PLAN_POLL: boolean;
  TELEGRAM_PLAN_POLL_DEFAULT_QUESTION: string;
  TELEGRAM_DONE_PHRASE_TAIL_BLOCKS: number;
};

export function loadConfig(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment (see .env.example)');
  }
  const e = parsed.data;
  const telegramProxyDisable =
    process.env.TELEGRAM_PROXY_DISABLE === '1' ||
    /^true$/i.test((process.env.TELEGRAM_PROXY_DISABLE ?? '').trim());
  const telegramProxyUrl = telegramProxyDisable ? undefined : e.TELEGRAM_PROXY_URL;

  return {
    TELEGRAM_BOT_TOKEN: e.TELEGRAM_BOT_TOKEN,
    TELEGRAM_ALLOWED_USER_IDS: e.TELEGRAM_ALLOWED_USER_IDS,
    TELEGRAM_API_ROOT: e.TELEGRAM_API_ROOT,
    TELEGRAM_PROXY_URL: telegramProxyUrl,
    HUB_URL: e.HUB_URL,
    HUB_PUBLIC_URL: e.HUB_PUBLIC_URL,
    HUB_INGEST_SECRET: e.HUB_INGEST_SECRET,
    HUB_CONTROL_SECRET: e.HUB_CONTROL_SECRET ?? e.HUB_INGEST_SECRET,
    AGENT_ID: e.AGENT_ID ?? 'cursor-agent',
    AGENT_LABEL: e.AGENT_LABEL ?? e.AGENT_ID ?? 'Cursor Agent',
    CDP_URL: e.CDP_URL ?? 'http://127.0.0.1:9222',
    CURSOR_PAGE_TITLE_SUBSTRING: e.CURSOR_PAGE_TITLE_SUBSTRING ?? 'Cursor',
    POLL_INTERVAL_MS: parseIntEnv(e.POLL_INTERVAL_MS, 4000),
    MIN_NOTIFY_INTERVAL_MS: parseIntEnv(e.MIN_NOTIFY_INTERVAL_MS, 8000),
    CONTINUE_PHRASE: e.CONTINUE_PHRASE ?? 'Continue',
    SEND_MODIFIERS: e.SEND_MODIFIERS ?? 'enter',
    SNAPSHOT_MAX_CHARS: parseIntEnv(e.SNAPSHOT_MAX_CHARS, 3500),
    TELEGRAM_NOTIFY_MODE: e.TELEGRAM_NOTIFY_MODE ?? 'idle',
    TELEGRAM_STABLE_MS: parseIntEnv(e.TELEGRAM_STABLE_MS, 16_000),
    TELEGRAM_SUMMARY_MAX_CHARS: parseIntEnv(e.TELEGRAM_SUMMARY_MAX_CHARS, 1200),
    TELEGRAM_DONE_PHRASE: e.TELEGRAM_DONE_PHRASE,
    CURSOR_PLAN_MODE_KEYS: e.CURSOR_PLAN_MODE_KEYS,
    CURSOR_AGENT_MODE_KEYS: e.CURSOR_AGENT_MODE_KEYS,
    CURSOR_COMPOSER_MODE_TRIGGER_SELECTOR: e.CURSOR_COMPOSER_MODE_TRIGGER_SELECTOR,
    CURSOR_PLAN_BUILD_KEYS: e.CURSOR_PLAN_BUILD_KEYS,
    TELEGRAM_PLAN_POLL: e.TELEGRAM_PLAN_POLL,
    TELEGRAM_PLAN_POLL_DEFAULT_QUESTION: e.TELEGRAM_PLAN_POLL_DEFAULT_QUESTION ?? 'Уточните по плану',
    TELEGRAM_DONE_PHRASE_TAIL_BLOCKS: Math.min(
      50,
      Math.max(2, parseIntEnv(e.TELEGRAM_DONE_PHRASE_TAIL_BLOCKS, 8)),
    ),
  };
}

export function isUserAllowed(config: AppConfig, userId: number): boolean {
  return config.TELEGRAM_ALLOWED_USER_IDS.includes(userId);
}

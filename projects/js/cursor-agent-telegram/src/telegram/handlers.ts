import { Bot, InlineKeyboard, Keyboard } from 'grammy';

import type { AppConfig } from '../config.js';
import { isUserAllowed } from '../config.js';
import {
  createNewAgentDialog,
  getAgentPage,
  listCursorAgents,
  sendInstruction,
  snapshotAgentText,
  triggerCursorPlanBuild,
  switchAgent,
} from '../cdp/cursor-session.js';
import type { CursorAgentItem } from '../cdp/cursor-session.js';
import { registerAgentSwitchToken, consumeAgentSwitchToken } from '../telegram-agent-callbacks.js';
import { formatAfterSwitchHtml } from '../telegram-html.js';
import { lastBlockSummary, stripDonePhraseFromSummary } from '../telegram-summary.js';
import { getPlanPollOptions } from '../telegram-plan-poll.js';

function isBotCommandAtStart(ctx: {
  message?: { text?: string; entities?: { type: string; offset: number }[] };
}): boolean {
  const entities = ctx.message?.entities;
  if (!entities?.length) return false;
  return entities.some((e) => e.type === 'bot_command' && e.offset === 0);
}

const BTN_SWITCH = 'Переключить агента';
const BTN_NEW_AGENT = 'Новый агент';

/** callback_data для inline-кнопки «Выполнить план» под idle «Готово», если текст похож на план. */
export const CALLBACK_PLAN_BUILD = 'planbuild';

export function planBuildInlineKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Выполнить план', CALLBACK_PLAN_BUILD);
}

/** Подпись на inline-кнопке: лимит Telegram ~64 символа. */
function agentButtonCaption(a: CursorAgentItem): string {
  const star = a.isActive ? '★ ' : '';
  const raw = `${star}${a.agentLabel}`.trim();
  if (raw.length <= 56) return raw;
  return `${raw.slice(0, 53)}…`;
}

function buildAgentPickerKeyboard(agents: CursorAgentItem[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  const slice = agents.slice(0, 24);
  for (let i = 0; i < slice.length; i++) {
    const a = slice[i]!;
    const token = registerAgentSwitchToken(a.agentId, a.agentLabel);
    kb.text(agentButtonCaption(a), `sw:${token}`);
    if (i % 2 === 1) kb.row();
  }
  if (slice.length % 2 === 1) kb.row();
  return kb;
}

function mainReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text(BTN_SWITCH)
    .row()
    .text(BTN_NEW_AGENT)
    .resized()
    .persistent();
}

function isReservedChatButtonText(u: string): boolean {
  if (u === BTN_SWITCH || u === BTN_NEW_AGENT) {
    return true;
  }
  return false;
}

export function formatWelcomeMessage(config: AppConfig, firstName?: string): string {
  const name = firstName?.trim();
  const head = name
    ? `Привет, ${name}! 👋\n\nЭто мост между Telegram и агентом Cursor на вашем компьютере.`
    : `Привет! 👋\n\nЭто мост между Telegram и агентом Cursor на вашем компьютере.`;

  const lines: string[] = [
    head,
    '',
    'Что умею:',
    '• Любое сообщение — отправлю в композер активного агента как инструкцию.',
    `• «${BTN_SWITCH}» — выбор агента; после переключения пришлю краткий итог из чата.`,
    `• «${BTN_NEW_AGENT}» — новый диалог агента в Cursor.`,
    '• Если итог похож на план или в снимке есть «View Plan» — под «Готово» будет кнопка «Выполнить план» (Build в Cursor).',
    '',
    'Команды: /help — справка. /keyboard — показать клавиатуру.',
    '',
    `Подключение к Cursor (CDP): ${config.CDP_URL}`,
  ];

  return lines.join('\n');
}

const HELP_TEXT =
  `Текстом в этот чат — инструкция в композер активного агента.\nФразу продолжения (CONTINUE_PHRASE) можно ввести текстом вручную.\n«${BTN_SWITCH}» — список агентов и переключение.\nКнопка «Выполнить план» под «Готово»: план по тексту/спискам или «View Plan» в снимке Cursor (Build; см. CURSOR_PLAN_BUILD_KEYS).\n«${BTN_NEW_AGENT}» — новый диалог.\nОпрос по итогу: голос уходит в Cursor.\n/keyboard — клавиатура.\n/whoami — ваш Telegram id.`;

export async function syncBotCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Приветствие и кнопки' },
      { command: 'keyboard', description: 'Показать клавиатуру снова' },
      { command: 'help', description: 'Справка по командам' },
      { command: 'whoami', description: 'Узнать свой Telegram id' },
    ]);
  } catch (e) {
    console.error('[telegram] setMyCommands:', e instanceof Error ? e.message : e);
  }
}

export function registerHandlers(bot: Bot, config: AppConfig): void {
  const replyHelp = async (ctx: { reply: (text: string) => Promise<unknown> }) => {
    await ctx.reply(HELP_TEXT);
  };

  const replyAgentPicker = async (
    ctx: {
      from?: { id: number };
      reply: (text: string, extra?: object) => Promise<unknown>;
    },
    title: string,
  ) => {
    if (!ctx.from || !isUserAllowed(config, ctx.from.id)) return;
    try {
      const page = await getAgentPage(config);
      const agents = await listCursorAgents(page);
      if (agents.length === 0) {
        await ctx.reply(
          'Не удалось найти диалоги агентов в интерфейсе Cursor. Откройте панель агентов и попробуйте снова.',
        );
        return;
      }
      const kb = buildAgentPickerKeyboard(agents);
      await ctx.reply(`${title}\n\nВыберите агента:`, { reply_markup: kb });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.reply(`Ошибка CDP: ${msg}`);
    }
  };

  const sendNewAgent = async (ctx: {
    from?: { id: number };
    reply: (text: string) => Promise<unknown>;
  }) => {
    if (!ctx.from || !isUserAllowed(config, ctx.from.id)) return;
    try {
      const page = await getAgentPage(config);
      await createNewAgentDialog(page);
      await ctx.reply('В Cursor создан новый диалог агента (New Agent / Новый чат).');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.reply(`Не удалось создать агента: ${msg}`);
    }
  };

  bot.command('whoami', async (ctx) => {
    const id = ctx.from?.id;
    await ctx.reply(
      id != null
        ? `Ваш Telegram user id: ${id}\nДобавьте это число в TELEGRAM_ALLOWED_USER_IDS в .env`
        : 'Не удалось определить id (откройте бота в личке и нажмите «Начать»).',
    );
  });

  bot.command('keyboard', async (ctx) => {
    if (!ctx.from || !isUserAllowed(config, ctx.from.id)) {
      if (ctx.from) {
        await ctx.reply(`Доступ запрещён. Ваш id: ${ctx.from.id} — добавьте в TELEGRAM_ALLOWED_USER_IDS.`);
      }
      return;
    }
    await ctx.reply('Клавиатура:', { reply_markup: mainReplyKeyboard() });
  });

  bot.command('start', async (ctx) => {
    if (!ctx.from) {
      await ctx.reply('Не вижу отправителя. Откройте диалог с ботом в личке и нажмите «Начать».');
      return;
    }
    if (!isUserAllowed(config, ctx.from.id)) {
      await ctx.reply(
        `Доступ запрещён.\nВаш user id: ${ctx.from.id}\nДобавьте это число в TELEGRAM_ALLOWED_USER_IDS в .env на ПК с ботом.`,
      );
      return;
    }

    const welcome = formatWelcomeMessage(config, ctx.from.first_name);

    try {
      await ctx.reply(welcome, { reply_markup: mainReplyKeyboard() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.reply(`Не удалось отправить сообщение (ошибка Telegram): ${msg}\nПопробуйте /keyboard.`);
    }
  });

  bot.command('help', replyHelp);

  bot.callbackQuery(/^sw:([a-f0-9]{8})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || !isUserAllowed(config, ctx.from.id)) return;
    const token = ctx.match![1]!;
    const data = consumeAgentSwitchToken(token);
    if (!data) {
      await ctx.reply('Кнопка устарела. Нажмите «Переключить агента» ещё раз.');
      return;
    }
    try {
      const page = await getAgentPage(config);
      const switched = await switchAgent(page, { agentId: data.agentId, agentLabel: data.agentLabel });
      if (!switched) {
        await ctx.reply(`Не удалось переключиться на «${data.agentLabel}».`);
        return;
      }
      await page.waitForTimeout(450);
      const snap = await snapshotAgentText(page, config.SNAPSHOT_MAX_CHARS);
      let summary = lastBlockSummary(snap, config.TELEGRAM_SUMMARY_MAX_CHARS);
      if (config.TELEGRAM_DONE_PHRASE) {
        summary = stripDonePhraseFromSummary(summary, config.TELEGRAM_DONE_PHRASE);
      }
      const html = formatAfterSwitchHtml(data.agentLabel, summary);
      await ctx.reply(html, { parse_mode: 'HTML' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.reply(`Ошибка: ${msg}`);
    }
  });

  bot.hears(/^Переключить агента$/, async (ctx) => {
    await replyAgentPicker(ctx, BTN_SWITCH);
  });

  bot.callbackQuery(CALLBACK_PLAN_BUILD, async (ctx) => {
    if (!ctx.from || !isUserAllowed(config, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Доступ запрещён', show_alert: true });
      return;
    }
    try {
      const page = await getAgentPage(config);
      const steps = await triggerCursorPlanBuild(page, config.CURSOR_PLAN_BUILD_KEYS);
      if (steps.length === 0) {
        await ctx.answerCallbackQuery({
          text: 'Не удалось: откройте план в Cursor или задайте CURSOR_PLAN_BUILD_KEYS в .env',
          show_alert: true,
        });
        return;
      }
      const detail = steps.join(' → ');
      const toast = detail.length > 190 ? `${detail.slice(0, 187)}…` : detail;
      await ctx.answerCallbackQuery({ text: toast });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.answerCallbackQuery({
        text: msg.length > 190 ? `${msg.slice(0, 187)}…` : msg,
        show_alert: true,
      });
    }
  });

  bot.hears(/^Новый агент$/, async (ctx) => {
    await sendNewAgent(ctx);
  });

  bot.on('message:text').filter(
    (ctx) => {
      if (isBotCommandAtStart(ctx)) return false;
      const t = ctx.message?.text ?? '';
      if (t.length === 0 || t.startsWith('/')) return false;
      const u = t.trim();
      if (isReservedChatButtonText(u)) return false;
      return true;
    },
    async (ctx) => {
      if (!ctx.from || !isUserAllowed(config, ctx.from.id)) return;
      const text = ctx.message?.text?.trim() ?? '';
      if (!text) return;
      try {
        const page = await getAgentPage(config);
        await sendInstruction(
          page,
          text,
          config.SEND_MODIFIERS === 'mod+enter' ? 'mod+enter' : 'enter',
        );
        await ctx.reply('Инструкция отправлена в Cursor.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await ctx.reply(`Ошибка: ${msg}`);
      }
    },
  );

  bot.on('poll_answer', async (ctx) => {
    const pa = ctx.pollAnswer;
    if (!pa?.user || !isUserAllowed(config, pa.user.id)) return;
    const ids = pa.option_ids;
    if (!ids?.length) return;
    const options = getPlanPollOptions(pa.poll_id);
    if (!options) {
      console.warn('[telegram] poll_answer: poll не найден или истёк TTL:', pa.poll_id);
      return;
    }
    const idx = ids[0]!;
    const selected = options[idx];
    if (!selected?.trim()) return;
    try {
      const page = await getAgentPage(config);
      await sendInstruction(
        page,
        selected,
        config.SEND_MODIFIERS === 'mod+enter' ? 'mod+enter' : 'enter',
      );
    } catch (e) {
      console.error('[telegram] poll_answer:', e instanceof Error ? e.message : e);
    }
  });
}

import { Bot, GrammyError, HttpError } from 'grammy';
import http from 'node:http';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { loadConfig } from './config.js';
import { registerHandlers, syncBotCommands, planBuildInlineKeyboard } from './telegram/handlers.js';
import {
  createNewAgentDialog,
  debugListCursorAgentCandidates,
  disconnectBrowser,
  getAgentPage,
  listCursorAgents,
  sendInstruction,
  snapshotAgentText,
  switchAgent,
} from './cdp/cursor-session.js';
import { probeCdpEndpoint } from './cdp/cdp-probe.js';
import { pushAgentHub } from './hub/push.js';
import {
  formatIdleDoneNotificationHtml,
  formatLegacyStateNotificationHtml,
  formatCdpErrorNotificationHtml,
} from './telegram-html.js';
import {
  preferPlanIdleSummary,
  stripDonePhraseFromSummary,
  stripTrailingCursorChrome,
  summaryLooksLikePlan,
  snapshotImpliesPlanBuildButton,
  tailBlocksContainPhrase,
} from './telegram-summary.js';
import { extractPlanChoicesFromSummary, registerPlanPoll } from './telegram-plan-poll.js';

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}

type AgentDescriptor = {
  agentId: string;
  agentLabel: string;
  isActive?: boolean;
  cursorDialogId?: string;
  previewText?: string;
};
type AgentHistoryMessage = {
  id: string;
  role: 'assistant';
  text: string;
  createdAt: string;
  agentId: string;
  cursorDialogId?: string;
};

const historyByAgent = new Map<string, AgentHistoryMessage[]>();
const agentsIndex = new Map<string, AgentDescriptor>();
const MAX_HISTORY_MESSAGES = 80;

function normalizeLabel(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sameAgentLabel(a: string, b: string): boolean {
  const x = normalizeLabel(a);
  const y = normalizeLabel(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.includes(y) || y.includes(x);
}

function appendAgentHistory(
  agentId: string,
  text: string,
  cursorDialogId?: string,
): AgentHistoryMessage | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const entry: AgentHistoryMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    text: trimmed,
    createdAt: new Date().toISOString(),
    agentId,
    cursorDialogId,
  };
  const prev = historyByAgent.get(agentId) ?? [];
  const next = [...prev, entry].slice(-MAX_HISTORY_MESSAGES);
  historyByAgent.set(agentId, next);
  return entry;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function formatFetchError(err: unknown): string {
  if (err instanceof Error) {
    const any = err as Error & { cause?: unknown };
    const c = any.cause;
    if (c instanceof Error) return `${err.message} (${c.message})`;
    return err.message;
  }
  return String(err);
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (process.env.TELEGRAM_PROXY_DISABLE === '1' || /^true$/i.test((process.env.TELEGRAM_PROXY_DISABLE ?? '').trim())) {
    console.log('[telegram] TELEGRAM_PROXY_DISABLE — запросы к api.telegram.org без прокси (прямое подключение).');
  }

  let bot: Bot | null = null;
  if (config.TELEGRAM_BOT_TOKEN) {
    const telegramProxyAgent = config.TELEGRAM_PROXY_URL
      ? new ProxyAgent(config.TELEGRAM_PROXY_URL)
      : null;
    const telegramClientConfig = config.TELEGRAM_PROXY_URL
      ? {
          // grammY передаёт AbortSignal из встроенного fetch Node,
          // а внешний undici ожидает свой тип AbortSignal — удаляем signal для совместимости.
          fetch: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
            undiciFetch(input as any, {
              ...Object.fromEntries(
                Object.entries((init ?? {}) as Record<string, unknown>).filter(([k]) => k !== 'signal'),
              ),
              dispatcher: telegramProxyAgent!,
            } as any)) as typeof fetch,
        }
      : {};
    bot = new Bot(config.TELEGRAM_BOT_TOKEN, {
      client: {
        ...(config.TELEGRAM_API_ROOT ? { apiRoot: config.TELEGRAM_API_ROOT } : {}),
        ...telegramClientConfig,
      },
    });
    bot.catch((err) => {
      const e = err.error;
      if (e instanceof GrammyError) {
        console.error(`[telegram] GrammyError: ${e.description} (${e.error_code})`);
      } else if (e instanceof HttpError) {
        console.error(`[telegram] HttpError: ${e.message}`);
      } else {
        console.error('[telegram] Ошибка в обработчике:', e);
      }
    });
    registerHandlers(bot, config);
    await syncBotCommands(bot);
  }

  if (config.TELEGRAM_PROXY_URL) {
    console.log(`[telegram] Proxy enabled: ${config.TELEGRAM_PROXY_URL}`);
  }

  let lastHash = '';
  let lastByAgentHash = new Map<string, string>();
  let lastNotifyAt = 0;
  let lastErrorAt = 0;
  let lastGoodSnapshot = '';
  /** Режим idle: хэш на предыдущем опросе (null — первый кадр). */
  let idlePrevPollHash: string | null = null;
  let idleStableSince = 0;
  let idleLastNotifiedHash = '';
  /** Один активный опрос: иначе при долгом CDP два poll() параллельно шлют одно и то же в Telegram. */
  let pollBusy = false;

  const tryPushHub = async (
    snapshot: string,
    cdpError: string | null,
    agents?: AgentDescriptor[],
    activeAgent?: { agentId: string; agentLabel: string },
  ): Promise<void> => {
    if (!config.HUB_URL || !config.HUB_INGEST_SECRET) return;
    try {
      await pushAgentHub(config.HUB_URL, config.HUB_INGEST_SECRET, {
        agentId: activeAgent?.agentId ?? config.AGENT_ID,
        agentLabel: activeAgent?.agentLabel ?? config.AGENT_LABEL,
        snapshot,
        cdpError,
        agents,
      });
    } catch (e) {
      console.error('[hub]', e instanceof Error ? e.message : e);
    }
  };

  // Локальный HTTP endpoint для управления (команды из портала → сюда).
  // Доступ только по Bearer `HUB_CONTROL_SECRET`. По умолчанию bind 127.0.0.1; из Docker на хост — AGENT_CONTROL_BIND=0.0.0.0.
  const controlPort = Number.parseInt(process.env.AGENT_CONTROL_PORT ?? '4000', 10);
  const controlHost = (process.env.AGENT_CONTROL_BIND ?? '127.0.0.1').trim() || '127.0.0.1';
  if (config.HUB_CONTROL_SECRET) {
    const server = http.createServer((req, res) => {
      void (async () => {
        try {
          const auth = req.headers.authorization ?? '';
          const expected = `Bearer ${config.HUB_CONTROL_SECRET}`;
          if (auth !== expected) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }

          const pathname = (req.url ?? '').split('?')[0] ?? '';
          const sendMode =
            config.SEND_MODIFIERS === 'mod+enter' ? ('mod+enter' as const) : ('enter' as const);

          const ensureSwitched = async (
            page: import('playwright-core').Page,
            agentId?: string,
            agentLabel?: string,
          ): Promise<{ ok: true } | { ok: false; error: string }> => {
            if (!agentId && !agentLabel) return { ok: true };
            const switched = await switchAgent(page, {
              agentId: (agentId ?? '').toString(),
              agentLabel: (agentLabel ?? '').toString(),
            });
            if (!switched) {
              return { ok: false, error: 'Не удалось переключиться на выбранного агента в Cursor' };
            }
            return { ok: true };
          };

          if (req.method === 'GET' && pathname === '/agents') {
            const page = await getAgentPage(config);
            const parsedAgents = await listCursorAgents(page).catch(() => []);
            if (parsedAgents.length > 0) {
              agentsIndex.clear();
              for (const agent of parsedAgents) {
                agentsIndex.set(agent.agentId, {
                  agentId: agent.agentId,
                  agentLabel: agent.agentLabel,
                  isActive: agent.isActive,
                  cursorDialogId: agent.cursorDialogId,
                  previewText: agent.previewText,
                });
              }
            } else if (agentsIndex.size === 0) {
              agentsIndex.set(config.AGENT_ID, {
                agentId: config.AGENT_ID,
                agentLabel: config.AGENT_LABEL,
                isActive: true,
              });
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, agents: [...agentsIndex.values()] }));
            return;
          }

          if (req.method === 'GET' && pathname === '/agents/raw') {
            const page = await getAgentPage(config);
            const raw = await debugListCursorAgentCandidates(page);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, raw }));
            return;
          }

          if (req.method === 'GET' && /^\/agents\/[^/]+\/history$/.test(pathname)) {
            const parts = pathname.split('/');
            const agentId = decodeURIComponent(parts[2] ?? '').trim();
            // Без кэша: каждый запрос history читает актуальный snapshot из Cursor.
            const page = await getAgentPage(config);
            const agent = agentsIndex.get(agentId);
            const switched = await ensureSwitched(page, agentId, agent?.agentLabel ?? '');
            if (!switched.ok) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: false, agentId, error: switched.error, history: [] }));
              return;
            }
            const snap = await snapshotAgentText(page, config.SNAPSHOT_MAX_CHARS).catch(() => '');
            const history =
              snap.trim().length > 0
                ? [
                    {
                      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      role: 'assistant' as const,
                      text: snap.trim(),
                      createdAt: new Date().toISOString(),
                      agentId,
                      cursorDialogId: agent?.cursorDialogId,
                    },
                  ]
                : [];
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, agentId, history }));
            return;
          }

          if (req.method === 'POST' && pathname === '/control') {
            const json = await readJson(req);
            const body = json as {
              action?: string;
              text?: string;
              agentId?: string;
              agentLabel?: string;
              correlationId?: string;
            };
            const action = body.action;
            const correlationId = (body.correlationId ?? '').toString().trim() || undefined;

            const page = await getAgentPage(config);
            if (action !== 'create') {
              const switched = await ensureSwitched(page, body.agentId, body.agentLabel);
              if (!switched.ok) {
                res.statusCode = 409;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: false, error: switched.error, correlationId }));
                return;
              }
            }

            if (action === 'continue') {
              await sendInstruction(page, config.CONTINUE_PHRASE, sendMode);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true, correlationId }));
              return;
            }

            if (action === 'send') {
              const text = (body.text ?? '').toString().trim();
              if (!text) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: 'Text is empty' }));
                return;
              }
              await sendInstruction(page, text, sendMode);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true, correlationId }));
              return;
            }

            if (action === 'create') {
              const label = (body.agentLabel ?? body.agentId ?? '').toString().trim();
              await createNewAgentDialog(page, label);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true, correlationId }));
              return;
            }

            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Unknown action' }));
            return;
          }

          if (req.method === 'POST' && /^\/agents\/[^/]+\/messages$/.test(pathname)) {
            const parts = pathname.split('/');
            const agentId = decodeURIComponent(parts[2] ?? '').trim();
            const json = await readJson(req);
            const body = json as { text?: string; correlationId?: string; agentLabel?: string };
            const text = (body.text ?? '').toString().trim();
            if (!text) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: 'Text is empty' }));
              return;
            }
            const page = await getAgentPage(config);
            const switched = await ensureSwitched(page, agentId, (body.agentLabel ?? '').toString());
            if (!switched.ok) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: false, error: switched.error }));
              return;
            }
            await sendInstruction(page, text, sendMode);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, correlationId: body.correlationId ?? null }));
            return;
          }

          if (req.method === 'POST' && /^\/agents\/[^/]+\/activate$/.test(pathname)) {
            const parts = pathname.split('/');
            const agentId = decodeURIComponent(parts[2] ?? '').trim();
            const json = await readJson(req);
            const body = json as { agentLabel?: string };
            const page = await getAgentPage(config);
            const switched = await ensureSwitched(page, agentId, (body.agentLabel ?? '').toString());
            if (!switched.ok) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: false, error: switched.error }));
              return;
            }
            // Подтверждаем, что активным стал именно запрошенный агент.
            const after = await listCursorAgents(page).catch(() => []);
            const active = after.find((x) => x.isActive);
            const expectedLabel = (body.agentLabel ?? '').toString().trim();
            const expectedId = agentId;
            const okById = !!active && active.agentId === expectedId;
            const okByLabel = !!active && !!expectedLabel && sameAgentLabel(active.agentLabel, expectedLabel);
            if (!okById && !okByLabel) {
              // В некоторых версиях Cursor активность не маркируется корректно в DOM,
              // поэтому не валим activate, если клик/поиск прошел без ошибок.
              console.warn(
                '[activate] soft-check mismatch:',
                JSON.stringify({
                  requestedAgentId: expectedId,
                  requestedAgentLabel: expectedLabel,
                  detectedActiveAgentId: active?.agentId ?? null,
                  detectedActiveAgentLabel: active?.agentLabel ?? null,
                }),
              );
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, agentId }));
            return;
          }

          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Not found' }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: msg }));
        }
      })();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      const canContinueWithoutControl = !!bot && !!config.TELEGRAM_BOT_TOKEN;
      if (err.code === 'EADDRINUSE') {
        console.error(
          `[control] Порт ${controlHost}:${controlPort} занят (EADDRINUSE). Уже запущен другой relay или другой процесс.`,
          'Закройте лишний экземпляр или задайте AGENT_CONTROL_PORT=другой_порт',
          'и в apps/portal — AGENT_CONTROL_URL=http://127.0.0.1:тот_же_порт',
        );
        if (canContinueWithoutControl) {
          console.error(
            '[control] Продолжаю без локального /control: Telegram-бот останется доступен, но команды из портала в этот relay недоступны.',
          );
          return;
        }
        console.error('[control] Критично: без /control переключение/команды будут работать некорректно. Завершаю процесс.');
        process.exit(1);
      }
      console.error('[control] Ошибка HTTP-сервера:', err.message);
      if (canContinueWithoutControl) {
        console.error('[control] Продолжаю без /control, чтобы не останавливать Telegram long polling.');
        return;
      }
      console.error('[control] Критично: завершаю процесс, чтобы supervisor перезапустил relay.');
      process.exit(1);
    });

    server.listen(controlPort, controlHost, () => {
      console.log(`[control] Listening on http://${controlHost}:${controlPort}/control`);
    });
  }

  if (process.env.AGENT_SKIP_CDP_PROBE !== '1') {
    const pr = await probeCdpEndpoint(config.CDP_URL, 3500);
    if (!pr.ok) {
      console.error(`[cdp] Нет ответа по ${config.CDP_URL}: ${pr.reason}`);
      console.error(
        '[cdp] Запустите Cursor с --remote-debugging-port=9222 (или поправьте CDP_URL). Проверка: curl URL/json',
      );
      console.error('[cdp] HTTP /control уже слушает — curl к порту должен отвечать 401 без Bearer.');
      console.error('[cdp] Пропуск проверки (не для продакшена): AGENT_SKIP_CDP_PROBE=1');
      process.exit(1);
    }
    console.log(`[cdp] Проверка порта: OK (${config.CDP_URL}/json)`);
  }

  const poll = async (): Promise<void> => {
    if (pollBusy) return;
    pollBusy = true;
    try {
      const page = await getAgentPage(config);
      const parsedAgents = await listCursorAgents(page).catch(() => []);
      if (parsedAgents.length > 0) {
        agentsIndex.clear();
        for (const agent of parsedAgents) {
          agentsIndex.set(agent.agentId, {
            agentId: agent.agentId,
            agentLabel: agent.agentLabel,
            isActive: agent.isActive,
            cursorDialogId: agent.cursorDialogId,
            previewText: agent.previewText,
          });
        }
      } else if (agentsIndex.size === 0) {
        agentsIndex.set(config.AGENT_ID, {
          agentId: config.AGENT_ID,
          agentLabel: config.AGENT_LABEL,
          isActive: true,
        });
      }
      const activeParsed: { agentId: string; agentLabel: string; cursorDialogId?: string } =
        parsedAgents.find((x) => x.isActive) ??
        (parsedAgents.length > 0 ? parsedAgents[0] : { agentId: config.AGENT_ID, agentLabel: config.AGENT_LABEL });
      const snap = await snapshotAgentText(page, config.SNAPSHOT_MAX_CHARS);
      const h = hash(snap);
      const changed = h !== lastHash;
      const activeHash = hash(`${activeParsed.agentId}:${snap}`);
      const changedForActive = activeHash !== lastByAgentHash.get(activeParsed.agentId);
      if (changed) {
        lastHash = h;
        lastGoodSnapshot = snap;
      }
      if (changedForActive) {
        lastByAgentHash.set(activeParsed.agentId, activeHash);
        appendAgentHistory(activeParsed.agentId, snap, activeParsed.cursorDialogId);
      }

      // Hub: шлём при каждом успешном опросе (и при пустом/неизменном снимке), чтобы на портале
      // обновлялось «Обновлено» и не замирал UI, пока агент только переопрашивает DOM.
      await tryPushHub(snap, null, parsedAgents.length > 0 ? parsedAgents : [...agentsIndex.values()], {
        agentId: activeParsed.agentId,
        agentLabel: activeParsed.agentLabel,
      });

      if (!bot || !config.TELEGRAM_BOT_TOKEN) return;

      const now = Date.now();

      if (config.TELEGRAM_NOTIFY_MODE === 'legacy') {
        if (!changed) return;
        let body =
          snap.length > 3900 ? `${snap.slice(0, 3880)}…\n(truncated)` : snap || '(пустой снимок — см. README, селекторы DOM)';
        if (config.TELEGRAM_DONE_PHRASE) {
          body = stripDonePhraseFromSummary(body, config.TELEGRAM_DONE_PHRASE);
        }
        if (now - lastNotifyAt < config.MIN_NOTIFY_INTERVAL_MS) return;
        lastNotifyAt = now;
        const legacyHtml = formatLegacyStateNotificationHtml(body);
        for (const uid of config.TELEGRAM_ALLOWED_USER_IDS) {
          await bot.api.sendMessage(uid, legacyHtml, { parse_mode: 'HTML' });
        }
        return;
      }

      if (idlePrevPollHash !== h) {
        idlePrevPollHash = h;
        idleStableSince = now;
        return;
      }

      if (now - idleStableSince < config.TELEGRAM_STABLE_MS) return;
      if (
        config.TELEGRAM_DONE_PHRASE &&
        !tailBlocksContainPhrase(
          snap,
          config.TELEGRAM_DONE_PHRASE,
          config.TELEGRAM_DONE_PHRASE_TAIL_BLOCKS,
        )
      ) {
        return;
      }
      if (h === idleLastNotifiedHash) return;
      if (now - lastNotifyAt < config.MIN_NOTIFY_INTERVAL_MS) return;

      idleLastNotifiedHash = h;
      lastNotifyAt = now;
      let summary = preferPlanIdleSummary(snap, config.TELEGRAM_SUMMARY_MAX_CHARS);
      if (config.TELEGRAM_DONE_PHRASE) {
        summary = stripDonePhraseFromSummary(summary, config.TELEGRAM_DONE_PHRASE);
      }
      if (!summary.trim()) {
        summary = '(нет текста итога после кодовой фразы)';
      }
      const label = activeParsed.agentLabel || config.AGENT_LABEL;
      let summaryForTg = summary;
      if (config.TELEGRAM_DONE_PHRASE) {
        summaryForTg = stripDonePhraseFromSummary(summaryForTg, config.TELEGRAM_DONE_PHRASE);
      }
      summaryForTg = stripTrailingCursorChrome(summaryForTg);
      const tgHtml = formatIdleDoneNotificationHtml(label, summaryForTg);
      const showPlanBuild =
        summaryLooksLikePlan(summaryForTg) || snapshotImpliesPlanBuildButton(snap);
      const idleExtra = showPlanBuild ? ({ reply_markup: planBuildInlineKeyboard() } as const) : {};
      for (const uid of config.TELEGRAM_ALLOWED_USER_IDS) {
        await bot.api.sendMessage(uid, tgHtml, {
          parse_mode: 'HTML',
          ...idleExtra,
        });
      }

      const pollExtract = config.TELEGRAM_PLAN_POLL
        ? extractPlanChoicesFromSummary(summaryForTg, config.TELEGRAM_PLAN_POLL_DEFAULT_QUESTION)
        : null;
      if (pollExtract) {
        const pollOptionInputs = pollExtract.options.map((text) => ({ text }));
        for (const uid of config.TELEGRAM_ALLOWED_USER_IDS) {
          try {
            const pollMsg = await bot.api.sendPoll(uid, pollExtract.question, pollOptionInputs, {
              is_anonymous: false,
              allows_multiple_answers: false,
              type: 'regular',
            });
            const pollId = pollMsg.poll?.id;
            if (pollId) registerPlanPoll(pollId, pollExtract.options);
          } catch (e) {
            console.error('[telegram] sendPoll:', e instanceof Error ? e.message : e);
          }
        }
      }
    } catch (e) {
      const msg = formatFetchError(e);
      const now = Date.now();
      if (now - lastErrorAt > 60_000) {
        lastErrorAt = now;
        console.error('[poll]', msg);
        await tryPushHub(lastGoodSnapshot, msg);
        if (bot && config.TELEGRAM_BOT_TOKEN) {
          for (const uid of config.TELEGRAM_ALLOWED_USER_IDS) {
            try {
              await bot.api.sendMessage(uid, formatCdpErrorNotificationHtml(msg), {
                parse_mode: 'HTML',
              });
            } catch {
              /* ignore */
            }
          }
        }
      }
    } finally {
      pollBusy = false;
    }
  };

  void poll();
  setInterval(() => {
    void poll();
  }, config.POLL_INTERVAL_MS);

  const shutdown = async (): Promise<void> => {
    if (bot) await bot.stop();
    await disconnectBrowser();
    process.exit(0);
  };

  if (!config.TELEGRAM_BOT_TOKEN || !bot) {
    console.log('Режим без Telegram: CDP → Hub (если задан HUB_URL).');
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    await new Promise(() => {});
    return;
  }

  try {
    const me = await bot.api.getMe();
    console.log(`Telegram API: бот @${me.username}, id=${me.id}`);
  } catch (e) {
    console.error('[telegram] getMe failed:', formatFetchError(e));
    if (config.TELEGRAM_PROXY_URL) {
      console.error(
        '[telegram] Запросы идут через TELEGRAM_PROXY_URL; если ошибки сети — проверьте, что прокси запущен и это HTTP CONNECT (не SOCKS).',
      );
      console.error(
        '[telegram] Для проверки без прокси: закомментируйте TELEGRAM_PROXY_URL в .env или задайте TELEGRAM_PROXY_DISABLE=1 и перезапустите relay.',
      );
    } else {
      console.error('[telegram] Проверьте доступ к api.telegram.org (DNS, файрвол, VPN).');
    }
  }

  await bot.start({
    onStart: (info) => {
      console.log(`Long polling (@${info.username}). Опрос Cursor каждые ${config.POLL_INTERVAL_MS} ms`);
    },
  });

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

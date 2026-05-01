import { randomBytes } from 'node:crypto';

/** Telegram callback_data макс. 64 байта; префикс `sw:` + 8 hex = 11 символов. */
const TTL_MS = 10 * 60 * 1000;

type Entry = { agentId: string; agentLabel: string; exp: number };

const store = new Map<string, Entry>();

function purge(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.exp < now) store.delete(k);
  }
}

/** Регистрирует одноразовый токен для callback `sw:<token>`. */
export function registerAgentSwitchToken(agentId: string, agentLabel: string): string {
  purge();
  const id = randomBytes(4).toString('hex');
  store.set(id, { agentId, agentLabel, exp: Date.now() + TTL_MS });
  return id;
}

export function consumeAgentSwitchToken(token: string): { agentId: string; agentLabel: string } | null {
  purge();
  const v = store.get(token);
  if (!v) return null;
  store.delete(token);
  if (v.exp < Date.now()) return null;
  return { agentId: v.agentId, agentLabel: v.agentLabel };
}

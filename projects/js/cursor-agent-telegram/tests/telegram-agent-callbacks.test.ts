import { describe, expect, it } from 'vitest';
import { consumeAgentSwitchToken, registerAgentSwitchToken } from '../src/telegram-agent-callbacks.js';

describe('telegram-agent-callbacks', () => {
  it('регистрация и одноразовое потребление токена', () => {
    const id = registerAgentSwitchToken('aid', 'Мой агент');
    expect(id).toMatch(/^[a-f0-9]{8}$/);
    const got = consumeAgentSwitchToken(id);
    expect(got).toEqual({ agentId: 'aid', agentLabel: 'Мой агент' });
    expect(consumeAgentSwitchToken(id)).toBe(null);
  });
});

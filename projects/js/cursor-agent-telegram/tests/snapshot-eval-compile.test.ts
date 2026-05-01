import { describe, it, expect } from 'vitest';
import { CHAT_CONTAINER_STRATEGIES } from '../src/cdp/chat-selectors.js';
import { SNAPSHOT_EVAL_LOGIC } from '../src/cdp/snapshot-eval-logic.js';

describe('snapshot eval', () => {
  it('компилируется с подстановкой CHAT_CONTAINERS', () => {
    const src = `var CHAT_CONTAINERS = ${JSON.stringify([...CHAT_CONTAINER_STRATEGIES])};\n${SNAPSHOT_EVAL_LOGIC}`;
    const fn = new Function('max', src);
    expect(typeof fn).toBe('function');
  });

  it('в списке контейнеров есть auxiliary bar', () => {
    expect(CHAT_CONTAINER_STRATEGIES.some((s) => s.includes('auxiliarybar'))).toBe(true);
  });
});

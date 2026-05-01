import { describe, expect, it } from 'vitest';

import {
  extractPlanChoicesFromSummary,
  getPlanPollOptions,
  registerPlanPoll,
} from '../src/telegram-plan-poll.js';

describe('extractPlanChoicesFromSummary', () => {
  const def = 'Уточните по плану';

  it('numbered list', () => {
    const r = extractPlanChoicesFromSummary(
      `Нужно выбрать направление:\n\n1. Вариант A\n2. Вариант B\n3. Вариант C`,
      def,
    );
    expect(r).not.toBeNull();
    expect(r!.question).toContain('Нужно выбрать');
    expect(r!.options).toEqual(['Вариант A', 'Вариант B', 'Вариант C']);
  });

  it('bullet list', () => {
    const r = extractPlanChoicesFromSummary(
      `- Первый пункт\n- Второй пункт\n- Третий`,
      def,
    );
    expect(r).not.toBeNull();
    expect(r!.options).toEqual(['Первый пункт', 'Второй пункт', 'Третий']);
  });

  it('lines ending with question mark', () => {
    const r = extractPlanChoicesFromSummary(
      `Уточните:\nПродолжить как есть?\nУпростить и отложить?\nОтменить задачу?`,
      def,
    );
    expect(r).not.toBeNull();
    expect(r!.question).toContain('Уточните');
    expect(r!.options.length).toBe(3);
  });

  it('returns null when fewer than 2 options', () => {
    expect(extractPlanChoicesFromSummary('1. Только один', def)).toBeNull();
    expect(extractPlanChoicesFromSummary('Текст без списка', def)).toBeNull();
  });

  it('uses default question when no intro', () => {
    const r = extractPlanChoicesFromSummary('1. A\n2. B', def);
    expect(r!.question).toBe(def);
  });

  it('truncates long options', () => {
    const longA = `${'x'.repeat(120)}a`;
    const longB = `${'y'.repeat(120)}b`;
    const r = extractPlanChoicesFromSummary(`1. ${longA}\n2. ${longB}`, def);
    expect(r).not.toBeNull();
    expect(r!.options[0]!.length).toBeLessThanOrEqual(100);
  });
});

describe('registerPlanPoll / getPlanPollOptions', () => {
  it('stores and returns options by poll id', () => {
    registerPlanPoll('poll-xyz', ['A', 'B']);
    expect(getPlanPollOptions('poll-xyz')).toEqual(['A', 'B']);
    expect(getPlanPollOptions('missing')).toBeUndefined();
  });
});

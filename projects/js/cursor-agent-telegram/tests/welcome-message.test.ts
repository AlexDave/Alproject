import { describe, expect, it } from 'vitest';
import { formatWelcomeMessage } from '../src/telegram/handlers.js';
import type { AppConfig } from '../src/config.js';

const base = {
  CDP_URL: 'http://127.0.0.1:9222',
} as AppConfig;

describe('formatWelcomeMessage', () => {
  it('содержит обращение по имени', () => {
    const t = formatWelcomeMessage(base, 'Анна');
    expect(t).toContain('Анна');
    expect(t).toContain('Привет');
  });

  it('без имени — нейтральное приветствие', () => {
    const t = formatWelcomeMessage(base, undefined);
    expect(t).toContain('Привет');
    expect(t).toContain('CDP');
  });

  it('включает URL CDP', () => {
    const t = formatWelcomeMessage(base, 'U');
    expect(t).toContain('http://127.0.0.1:9222');
  });
});

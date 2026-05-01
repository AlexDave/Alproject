import { describe, expect, it } from 'vitest';
import { classifyComposerModeSignals } from '../src/cdp/cursor-session.js';

describe('classifyComposerModeSignals', () => {
  it('composer — ∞ в снимке DOM', () => {
    expect(classifyComposerModeSignals('∞ chevron')).toBe('composer');
    expect(classifyComposerModeSignals('unicode \u221e')).toBe('composer');
  });

  it('plan по codicon / aria / href', () => {
    expect(classifyComposerModeSignals('codicon-book Plan Mode')).toBe('plan');
    expect(classifyComposerModeSignals('href="#plan-icon"')).toBe('plan');
  });

  it('agent по подстроке', () => {
    expect(classifyComposerModeSignals('something Agent composer.agent')).toBe('agent');
  });

  it('unknown без маркеров', () => {
    expect(classifyComposerModeSignals('gpt-4 turbo')).toBe('unknown');
  });
});

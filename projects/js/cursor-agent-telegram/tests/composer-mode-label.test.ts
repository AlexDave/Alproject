import { describe, expect, it } from 'vitest';
import { classifyComposerModeLabel } from '../src/cdp/cursor-session.js';

describe('classifyComposerModeLabel', () => {
  it('composer — символ ∞', () => {
    expect(classifyComposerModeLabel('∞')).toBe('composer');
    expect(classifyComposerModeLabel('\u221e')).toBe('composer');
  });

  it('plan / planning / План', () => {
    expect(classifyComposerModeLabel('Plan')).toBe('plan');
    expect(classifyComposerModeLabel('Planning')).toBe('plan');
    expect(classifyComposerModeLabel('План')).toBe('plan');
  });

  it('agent', () => {
    expect(classifyComposerModeLabel('Agent')).toBe('agent');
  });

  it('unknown для пустой строки', () => {
    expect(classifyComposerModeLabel('')).toBe('unknown');
  });
});

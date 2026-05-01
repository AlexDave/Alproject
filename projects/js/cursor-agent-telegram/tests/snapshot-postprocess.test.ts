import { describe, it, expect } from 'vitest';
import { postProcessSnapshotText } from '../src/cdp/cursor-session.js';

describe('postProcessSnapshotText', () => {
  it('разрывает склейку UI: Ran command, shell, tsc, HAS __name', () => {
    const raw =
      'Ran command: cd, npm run, node$cd "D:/Project/foo" && npm run build' +
      '> tsc -p tsconfig.jsonHAS __nameUpdating documentation comment4sСтрока';
    const out = postProcessSnapshotText(raw);
    expect(out).toContain('Ran command:');
    expect(out).toContain('$cd "D:/Project/foo"');
    expect(out).toContain('> tsc -p tsconfig.json');
    expect(out).toContain('HAS __name');
    expect(out).toContain('Updating documentation comment');
    expect(out).toContain('Строка');
    expect(out.split('\n').length).toBeGreaterThan(3);
  });

  it('ничего не удаляет — многострочный снимок сохраняет строки', () => {
    const raw = ['Ответ агента.', 'Ran command: x', 'Explored1 search', 'Ещё текст.'].join('\n');
    const out = postProcessSnapshotText(raw);
    expect(out).toContain('Ответ агента');
    expect(out).toContain('Ran command');
    expect(out).toContain('Explored1');
    expect(out).toContain('Ещё текст');
  });
});

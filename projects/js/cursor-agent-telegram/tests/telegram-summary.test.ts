import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_BLOCK_SEP,
  lastBlockSummary,
  preferPlanIdleSummary,
  stripDonePhraseFromSummary,
  stripEditorTabPrefixes,
  stripTrailingCursorChrome,
  snapshotImpliesPlanBuildButton,
  summaryLooksLikePlan,
  tailBlocksContainPhrase,
} from '../src/telegram-summary.js';

describe('lastBlockSummary', () => {
  it('если последний блок длинный — берёт только его', () => {
    const longLast = 'x'.repeat(120);
    const snap = `noise${SNAPSHOT_BLOCK_SEP}${longLast}`;
    expect(lastBlockSummary(snap, 500)).toBe(longLast);
  });

  it('если последний блок короткий — добавляет предыдущий (основной текст часто там)', () => {
    const prose = 'Здесь нормальное объяснение задачи пользователю.';
    const tail = '$ npm run build';
    const snap = `${prose}${SNAPSHOT_BLOCK_SEP}${tail}`;
    const out = lastBlockSummary(snap, 500);
    expect(out).toContain(prose);
    expect(out).toContain(tail);
    expect(out).toContain('────────');
  });

  it('короткие блоки подряд — берёт самый длинный из хвоста', () => {
    const snap = `a${SNAPSHOT_BLOCK_SEP}b${SNAPSHOT_BLOCK_SEP}${'z'.repeat(50)}`;
    expect(lastBlockSummary(snap, 500)).toBe('z'.repeat(50));
  });

  it('без разделителя возвращает весь текст', () => {
    expect(lastBlockSummary('один блок без разделителей', 100)).toBe('один блок без разделителей');
  });

  it('обрезает по maxChars с многоточием', () => {
    const long = 'x'.repeat(100);
    const out = lastBlockSummary(`intro${SNAPSHOT_BLOCK_SEP}${long}`, 25);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(25);
  });

  it('пустая строка даёт заглушку', () => {
    expect(lastBlockSummary('   ', 100)).toContain('пустой снимок');
  });
});

describe('tailBlocksContainPhrase', () => {
  const phrase = '<<<DONE>>>';

  it('находит фразу только в последнем блоке', () => {
    const snap = `old${SNAPSHOT_BLOCK_SEP}ветка без фразы${SNAPSHOT_BLOCK_SEP}итог ${phrase}`;
    expect(tailBlocksContainPhrase(snap, phrase)).toBe(true);
  });

  it('находит фразу в предпоследнем блоке', () => {
    const snap = `старый ${phrase}${SNAPSHOT_BLOCK_SEP}короткий хвост`;
    expect(tailBlocksContainPhrase(snap, phrase)).toBe(true);
  });

  it('при tailBlockCount=2 не считает фразу в блоке выше двух последних', () => {
    const snap = `${phrase}${SNAPSHOT_BLOCK_SEP}a${SNAPSHOT_BLOCK_SEP}b${SNAPSHOT_BLOCK_SEP}c`;
    expect(tailBlocksContainPhrase(snap, phrase, 2)).toBe(false);
  });

  it('при большем хвосте находит фразу глубже за последний статус', () => {
    const snap = `noise${SNAPSHOT_BLOCK_SEP}x${SNAPSHOT_BLOCK_SEP}x${SNAPSHOT_BLOCK_SEP}${phrase}${SNAPSHOT_BLOCK_SEP}$ ok`;
    expect(tailBlocksContainPhrase(snap, phrase, 8)).toBe(true);
  });

  it('пустая фраза — считается найденной', () => {
    expect(tailBlocksContainPhrase('anything', '')).toBe(true);
  });
});

describe('preferPlanIdleSummary', () => {
  it('берёт блок-план, если после него короткий статусный хвост', () => {
    const plan = [`## План`, ``, `1. Шаг один`, `2. Шаг два`, `3. Шаг три`].join('\n');
    const tail = '$ done';
    const snap = `${plan}${SNAPSHOT_BLOCK_SEP}${tail}`;
    const out = preferPlanIdleSummary(snap, 800);
    expect(out).toContain('Шаг один');
    expect(out).not.toContain('$ done');
  });

  it('если признаков плана нет — как lastBlockSummary', () => {
    const snap = `просто текст${SNAPSHOT_BLOCK_SEP}$ npm run x`;
    expect(preferPlanIdleSummary(snap, 500)).toContain('npm');
  });
});

describe('stripDonePhraseFromSummary', () => {
  it('удаляет все вхождения кодовой фразы', () => {
    expect(stripDonePhraseFromSummary('текст <<<X>>> конец', '<<<X>>>')).toBe('текст  конец');
  });

  it('убирает строку целиком из одного маркера', () => {
    expect(stripDonePhraseFromSummary('Привет.\n\n<<<CURSOR_RELAY_DONE>>>\n', '<<<CURSOR_RELAY_DONE>>>')).toBe('Привет.');
  });

  it('убирает маркер с NBSP рядом с подстрокой', () => {
    const t = `Итог.\n\u00a0<<<CURSOR_RELAY_DONE>>>\u00a0`;
    expect(stripDonePhraseFromSummary(t, '<<<CURSOR_RELAY_DONE>>>')).toBe('Итог.');
  });
});

describe('stripTrailingCursorChrome', () => {
  it('отрезает хвост от склейки .plan.md с текстом', () => {
    const t = `${'x'.repeat(50)}нормальный конец\n\n1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. j\n11. k\n12. l\n13. m\n14. n\n15. o\n16. p\n17. q\n18. r\n19. s\n20. t\n21. u\n22. v\n23. w\n24. x\n25. y\n26. z\n\nтекст плана\n\nсерьёзноfoo.plan.mdБалбал`;
    const out = stripTrailingCursorChrome(t);
    expect(out).toContain('текст плана');
    expect(out).not.toContain('Балбал');
  });

  it('отрезает от View Plan', () => {
    const t = `длинный итог работы с планом\n1. a\n2. b\n\nView Plan Auto`;
    expect(stripTrailingCursorChrome(t)).not.toContain('View Plan');
  });
});

describe('summaryLooksLikePlan', () => {
  it('true для нумерации из двух пунктов', () => {
    expect(summaryLooksLikePlan(`intro\n\n1. one\n2. two\n${'more'.repeat(10)}`)).toBe(true);
  });

  it('false для короткого статуса', () => {
    expect(summaryLooksLikePlan('$ npm run ok')).toBe(false);
  });

  it('true если есть View Plan (как в UI Cursor)', () => {
    expect(summaryLooksLikePlan('статус\nView Plan')).toBe(true);
  });
});

describe('snapshotImpliesPlanBuildButton', () => {
  it('true при подстроке View Plan в полном снимке', () => {
    expect(snapshotImpliesPlanBuildButton('ответ\n\nView Plan\nAuto')).toBe(true);
  });

  it('false без маркера', () => {
    expect(snapshotImpliesPlanBuildButton('только текст итога')).toBe(false);
  });
});

describe('stripEditorTabPrefixes', () => {
  it('убирает слитый с кодом префикс file.ts+12-34', () => {
    const raw =
      "telegram-summary.test.ts+23-7import { describe, expect, it } from 'vitest';import { x } from './a.js'";
    const out = stripEditorTabPrefixes(raw);
    expect(out).not.toMatch(/\.ts\+\d+-\d+/i);
    expect(out).toMatch(/import/);
  });
});

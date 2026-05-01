/**
 * Тело функции (max) → string для `new Function('max', injected + this)`.
 * Выполняется в рендерере Cursor. Перед этим текстом подставляется:
 * `var CHAT_CONTAINERS = ...json...;`
 *
 * Модель как в CursorRemote: контейнер чата → элементы [data-flat-index] → текст блока
 * по роли/виджетам (markdown-root, терминал, collapsible).
 */
export const SNAPSHOT_EVAL_LOGIC = `
  var MIN_CHARS = 28;
  var MIN_STRUCTURED = 12;

  function findFirst(selectors) {
    for (var si = 0; si < selectors.length; si++) {
      try {
        var el = document.querySelector(selectors[si]);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  function nbspToSpace(s) {
    return (s || '').replace(/\\u00a0/g, ' ');
  }

  function extractTerminalBlock(scope) {
    var run =
      scope.querySelector('.composer-terminal-tool-call-block-container') ||
      scope.querySelector('.composer-tool-call-container.composer-terminal-compact-mode');
    if (!run) return '';
    var desc = run.querySelector('.composer-terminal-top-header-description');
    var cmd =
      run.querySelector('.composer-terminal-command-expanded-text') ||
      run.querySelector('.composer-terminal-command-editor') ||
      run.querySelector('.composer-terminal-command-wrapper') ||
      run.querySelector('.composer-tool-call-header-content');
    var parts = [];
    if (desc) {
      var d = nbspToSpace(desc.textContent || '').trim();
      if (d) parts.push(d);
    }
    if (cmd) {
      var c = nbspToSpace(cmd.textContent || '').trim().replace(/^\\$\\s*/, '');
      if (c) parts.push('$ ' + c);
    }
    return parts.join('\\n');
  }

  function extractMarkdown(scope) {
    var md = scope.querySelector('.markdown-root');
    if (md) return nbspToSpace(md.textContent || '').trim();
    return '';
  }

  function extractCollapsible(scope) {
    var col =
      scope.querySelector('.ui-thinking-collapsible') ||
      scope.querySelector('.ui-step-group-collapsible') ||
      scope.querySelector('.ui-collapsible');
    if (!col) return '';
    var h = col.querySelector(
      '.ui-collapsible-header, [class*="collapsible-header"], [class*="CollapsibleHeader"]',
    );
    var b = col.querySelector(
      '.ui-collapsible-content, [class*="collapsible-content"], [class*="CollapsibleContent"]',
    );
    var hp = h ? nbspToSpace(h.textContent || '').replace(/\\s+/g, ' ').trim() : '';
    var bp = b ? nbspToSpace(b.textContent || '').trim() : '';
    if (!hp && !bp) return '';
    return hp + (hp && bp ? '\\n' : '') + bp;
  }

  function extractBlockText(wrapper) {
    var msgEl = wrapper.querySelector('[data-message-role]') || wrapper;
    var role = msgEl.getAttribute('data-message-role');
    var kind = msgEl.getAttribute('data-message-kind');

    if (role === 'human') {
      var pe = wrapper.querySelector('.plan-execution-message-content');
      if (pe) return nbspToSpace(pe.textContent || '').trim();
      var inputEl =
        wrapper.querySelector('[data-mode-id]') ||
        wrapper.querySelector('textarea') ||
        wrapper.querySelector('[contenteditable="true"]');
      if (inputEl) {
        var it = nbspToSpace(inputEl.textContent || '').trim();
        if (it) return it;
      }
      return nbspToSpace(wrapper.textContent || '').trim();
    }

    if (role === 'ai' && kind === 'tool') {
      var termTool = extractTerminalBlock(wrapper);
      if (termTool) return termTool;
      var compact = wrapper.querySelector('.composer-tool-former-message');
      if (compact) return nbspToSpace(compact.textContent || '').trim();
      return nbspToSpace(msgEl.textContent || '').trim();
    }

    if (role === 'ai') {
      var md = extractMarkdown(wrapper);
      if (md) return md;
      return nbspToSpace(wrapper.textContent || '').trim();
    }

    var termAny = extractTerminalBlock(wrapper);
    if (termAny) return termAny;

    var col = extractCollapsible(wrapper);
    if (col) return col;

    var mg = wrapper.querySelector('.composer-message-group');
    if (mg) return nbspToSpace(mg.textContent || '').trim();

    return nbspToSpace(wrapper.textContent || '').trim();
  }

  function extractStructured(container) {
    var nodes = container.querySelectorAll('[data-flat-index]');
    if (!nodes || nodes.length === 0) return '';
    var items = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var raw = el.getAttribute('data-flat-index') || '0';
      var idx = parseInt(raw, 10);
      if (isNaN(idx)) idx = 0;
      items.push({ idx: idx, el: el });
    }
    items.sort(function (a, b) {
      return a.idx - b.idx;
    });
    var chunks = [];
    for (var j = 0; j < items.length; j++) {
      var txt = extractBlockText(items[j].el).trim();
      if (txt) chunks.push(txt);
    }
    return chunks.join('\\n\\n---\\n\\n');
  }

  function isWorkbenchChromeNoise(raw) {
    var c = raw.replace(/\\s+/g, '');
    if (c.length < 12) return false;
    if (/Untitled\\s*\\(Workspace\\)/i.test(raw) && raw.length < 800) return true;
    if (/FileEdit|EditSelection|SelectionView|ViewGo|GoRun|RunTerminal|TerminalHelp/i.test(c)) return true;
    if (/^File(Edit|)(View|)(Go|)(Run|)(Terminal|)(Help|)/i.test(c)) return true;
    return false;
  }

  function scoreBlock(text) {
    if (!text || isWorkbenchChromeNoise(text)) return -1;
    return text.trim().length;
  }

  function fallbackBestText() {
    var best = '';
    var bestScore = -1;
    for (var s = 0; s < CHAT_CONTAINERS.length; s++) {
      var sel = CHAT_CONTAINERS[s];
      var nodeList;
      try {
        nodeList = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      for (var i = 0; i < nodeList.length; i++) {
        var el = nodeList[i];
        var t = (el.textContent || '').trim();
        var sc = scoreBlock(t);
        if (sc >= MIN_CHARS && sc > bestScore) {
          best = t;
          bestScore = sc;
        }
      }
    }
    if (best) return best;
    var wb = document.querySelector('.monaco-workbench');
    if (wb) {
      var exclude = wb.querySelectorAll(
        '.titlebar, .monaco-menubar, .menubar, [role="menubar"], .window-title, .window-controls-container',
      );
      var excludeSet = new Set();
      for (var exi = 0; exi < exclude.length; exi++) excludeSet.add(exclude[exi]);
      var parts = wb.querySelectorAll('.part');
      for (var pi = 0; pi < parts.length; pi++) {
        var part = parts[pi];
        if (excludeSet.has(part)) continue;
        var skip = false;
        excludeSet.forEach(function (exNode) {
          if (part.contains(exNode)) skip = true;
        });
        if (skip) continue;
        var pt = (part.textContent || '').trim();
        var psc = scoreBlock(pt);
        if (psc >= MIN_CHARS && psc > bestScore) {
          best = pt;
          bestScore = psc;
        }
      }
      if (best) return best;
    }
    var body = document.body && document.body.innerText ? document.body.innerText.trim() : '';
    if (body && !isWorkbenchChromeNoise(body)) return body;
    return '';
  }

  var root = findFirst(CHAT_CONTAINERS);
  if (root) {
    var structured = extractStructured(root);
    if (structured.length >= MIN_STRUCTURED) {
      /* Хвост важнее начала: иначе длинный чат отрезает последние сообщения и кодовую фразу завершения. */
      if (structured.length <= max) return structured;
      return structured.slice(-max);
    }
    var flatOnly = (root.textContent || '').trim();
    if (flatOnly.length >= MIN_CHARS && scoreBlock(flatOnly) >= 0) {
      if (flatOnly.length <= max) return flatOnly;
      return flatOnly.slice(-max);
    }
  }

  var fb = fallbackBestText();
  if (!fb) return '';
  if (fb.length <= max) return fb;
  return fb.slice(-max);
`.trim();

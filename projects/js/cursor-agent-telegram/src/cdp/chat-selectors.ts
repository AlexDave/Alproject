/**
 * Стратегии селекторов в духе [CursorRemote](https://github.com/len5ky/CursorRemote):
 * сначала workbench auxiliary bar / composer, затем запасные варианты.
 */
export const CHAT_CONTAINER_STRATEGIES = [
  '#workbench\\.parts\\.auxiliarybar',
  'div.composer-bar.editor',
  '[class*="composer-bar"]',
  '[class*="composer-panel"]',
  '[class*="chat-widget"]',
  '.interactive-session',
  '[class*="interactive-session"]',
  '[class*="chat-view"]',
  '[class*="aichat"]',
  '[class*="copilot-chat"]',
  '[class*="composer"]',
  '[class*="agent-chat"]',
  '[aria-label*="Chat"]',
  '[aria-label*="chat"]',
  '[aria-label*="Agent"]',
  '[aria-label*="agent"]',
  '[data-testid*="chat"]',
  '[data-testid*="Chat"]',
] as const;

/** Поле ввода агента (порядок важен). */
export const CHAT_INPUT_STRATEGIES = [
  '#workbench\\.parts\\.auxiliarybar [contenteditable="true"]',
  '#workbench\\.parts\\.auxiliarybar textarea',
  '#workbench\\.parts\\.auxiliarybar [role="textbox"]',
  '.composer-bar [contenteditable="true"]',
  '.composer-bar textarea',
  '[class*="composer-bar"] textarea',
  '[class*="composer-panel"] textarea',
  'textarea',
  '[contenteditable="true"]',
] as const;

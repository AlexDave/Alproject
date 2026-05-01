/**
 * Перед `npm run dev`: освобождает порты из start-projects.json → killPortsBeforeDev,
 * чтобы не оставались старые Next/relay после Ctrl+C или второго терминала.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import killPort from 'kill-port';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, 'start-projects.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const ports = Array.isArray(config.killPortsBeforeDev) ? config.killPortsBeforeDev : [3000, 3001, 4000];
const nextCachePath = join(root, 'apps', 'portal', '.next');

console.log(`[dev] Освобождаю порты: ${ports.join(', ')}`);
for (const port of ports) {
  try {
    await killPort(port);
  } catch {
    /* порт свободен или недоступен — не блокируем dev */
  }
}
console.log(`[dev] Кэш не очищаем (${nextCachePath}) — это предотвращает MODULE_NOT_FOUND в живом dev-процессе.`);
console.log('[dev] Старт сервисов…\n');

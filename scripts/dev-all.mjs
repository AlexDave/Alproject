import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import concurrently from 'concurrently';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, 'start-projects.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const profile = process.env.ALPROJECT_DEV_PROFILE ?? 'default';

if (!Array.isArray(config.services) || config.services.length === 0) {
  console.error('start-projects.json: expected a non-empty "services" array.');
  process.exit(1);
}

const services = config.services.filter((s) => {
  if (!s.profiles || s.profiles.length === 0) return true;
  return s.profiles.includes(profile);
});

if (services.length === 0) {
  console.error(`start-projects.json: no services for profile "${profile}".`);
  process.exit(1);
}

const defaultColors = ['blue', 'magenta', 'green', 'cyan', 'yellow'];
const commands = services.map((s, i) => {
  if (!s.name || !s.npmScript) {
    console.error('start-projects.json: each service needs "name" and "npmScript".');
    process.exit(1);
  }
  return {
    name: s.name,
    command: `npm run ${s.npmScript}`,
    cwd: root,
    prefixColor: s.prefixColor ?? defaultColors[i % defaultColors.length],
  };
});

const lines = services
  .map((s) => {
    const u = Array.isArray(s.urls) && s.urls.length ? ` -> ${s.urls.join(', ')}` : '';
    return `  - ${s.name}${u}`;
  })
  .join('\n');
console.log(`Alproject dev (profile=${profile}):\n${lines}\n`);

const { result } = concurrently(commands, {
  prefix: 'name',
});

result.then(
  () => process.exit(0),
  () => process.exit(1),
);

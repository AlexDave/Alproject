# Alproject

Монорепозиторий Hub-портфолио. Зависимости и workspaces: **npm** (`package-lock.json` в корне). Скрипты подпроектов в `projects/js/*` запускаются через `npm run … --prefix projects/js/<имя>` или корневые алиасы из `package.json`.

- Портал: `apps/portal`
- Общий пакет UI/утилит: `packages/shared` (`@alproject/shared`)
- Микропроекты: `projects/js/*`
- Docker / локальный стек: `docker-compose.yml`
- Kubernetes: `k8s/README.md`

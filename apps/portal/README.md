# Hub Portal

Next.js App Router — главный dashboard монорепозитория Alproject.

## Команды

Из корня монорепозитория:

- `npm run dev:portal` — разработка только портала
- `npm run dev` — по умолчанию только портал; полный стек: `ALPROJECT_DEV_PROFILE=full npm run dev`; портал + шлюз ingest: `ALPROJECT_DEV_PROFILE=agent npm run dev`
- `npm run build:portal` — production-сборка
- `npm run test:ingest-contract` — smoke контракта ingest (Zod)

Из этой папки: `npm run dev`, `npm run build`.

## Реестр проектов

На главной странице выводятся записи из `project.manifest.json`: в `apps/portal`, а также в `projects/*/*/`.

## Hub агента Cursor (`/agent-hub`)

Локальный просмотр снимка панели агента (данные шлёт сервис `projects/js/cursor-agent-telegram` в `POST /api/agent-hub/ingest`).

Переменные окружения — см. [`.env.example`](.env.example): `HUB_PASSWORD`, `HUB_SESSION_SECRET`, `HUB_INGEST_SECRET`. Опционально `AGENT_HUB_BACKEND_URL` — URL сервиса `@alproject/agent-hub-gateway` (отдельный процесс/контейнер); иначе состояние хранится в памяти процесса Next.js.

Формат тела ingest: [`docs/agent-hub-ingest.md`](docs/agent-hub-ingest.md).

## Docker

Из корня: `docker compose up --build portal`. Шлюз ingest: `docker compose --profile agent up --build portal agent-hub-gateway` (задайте `AGENT_HUB_BACKEND_URL=http://agent-hub-gateway:3010` у сервиса `portal`). Hello-lab: профиль `lab`.

Контекст сборки портала — корень репозитория (`docker-compose.yml`).

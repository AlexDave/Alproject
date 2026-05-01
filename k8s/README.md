# Kubernetes (Docker Desktop)

## Docker daemon не поднимается (`dockerDesktopLinuxEngine` / pipe)

Это среда Windows/WSL, не код репозитория. Кратко:

1. Запустите **Docker Desktop** и дождитесь рабочего состояния в трее.
2. В корне репозитория **`npm run k8s:check-docker`** — скрипт проверяет `docker info`; на Windows при необходимости **пытается запустить** `Docker Desktop.exe` и ждёт daemon (до **180 с**, см. переменные в выводе при ошибке).
3. В PowerShell от администратора: `wsl --update`, затем `wsl --shutdown`, снова откройте Docker Desktop.
4. Диагностика: Docker Desktop → **Troubleshoot** → gather diagnostics.

Флаги Skaffold: используйте **`npm run k8s:dev:debug`** или **`skaffold dev -v debug`**, не **`skaffold dev -debug`** (ломает теги образов).

### Зависло «Starting the Docker Engine…»

Значит не поднимается Linux‑backend (WSL2 / VM). По шагам: перезагрузка ПК → **PowerShell (админ):** `wsl --update`, `wsl --shutdown` → снова Docker Desktop → включить компоненты **WSL** и **Virtual Machine Platform** → проверить виртуализацию в BIOS → **Troubleshoot** → Restart / Reset (сброс удалит локальные образы) → при необходимости переустановка Docker Desktop. Пока Engine не стартует, Kubernetes/Skaffold недоступны; портал без k8s: **`npm run dev:portal`** из корня репозитория.

### Что видно в логах Docker Desktop (%LOCALAPPDATA%\\Docker\\log)

Типичный паттерн при «вечном» запуске Engine (`monitor.log`, `com.docker.backend.exe.log`):

- `still waiting for the engine to respond to _ping after …`
- `still waiting for init control API to respond …`
- `cannot toggle VM OTel collector, backend is not running`

Это значит: UI и **com.docker.backend** живы, а процесс **Linux Engine** внутри VM/WSL **не отвечает по IPC** (подвис или не стартовал). Исправление только на стороне Docker/WSL.

**Быстрая попытка из репозитория:**

```bash
npm run docker:recover
```

Скрипт завершает процессы Docker Desktop / `com.docker.*` / `vpnkit*` (принудительно), затем **`wsl --shutdown`** и снова запускает **Docker Desktop.exe**. Если через несколько минут **`docker info`** всё равно падает → Docker Desktop → **Troubleshoot** → **Reset to factory defaults** или переустановка.

## Включите кластер

В **Docker Desktop** → **Settings** → **Kubernetes** → **Enable Kubernetes** → **Apply & Restart**. Должен появиться файл `%USERPROFILE%\.kube\config`, контекст обычно `docker-desktop`.

Проверка: `kubectl cluster-info`.

## Skaffold (watch → сборка образов → деплой)

В корне репозитория лежит [skaffold.yaml](../skaffold.yaml): при сохранении файлов в контекстах сборки Docker пересобирает затронутые образы и накатывает их в кластер через тот же Kustomize (`k8s/`). Образы **не пушатся** в registry (`push: false`), используется локальный Docker Desktop.

**Установите Skaffold CLI**: [Installing Skaffold](https://skaffold.dev/docs/install/) — для Windows подойдёт [Chocolatey](https://community.chocolatey.org/packages/skaffold) (`choco install skaffold`), [Scoop](https://scoop.sh/) или [релиз с GitHub](https://github.com/GoogleContainerTools/skaffold/releases). Проверка: `skaffold version`.

Из корня:

```bash
npm run k8s:dev
# или одноразово без отслеживания файлов:
npm run k8s:run
```

Узкая пересборка (быстрее при работе только с одним сервисом):

```bash
npm run k8s:dev:portal
npm run k8s:dev:gateway
npm run k8s:dev:hello-lab
# эквивалент: skaffold dev -p portal
```

Образы собираются как **production** (`next build`, standalone в Dockerfile). Это не hot-reload в браузере; для мгновенной правки UI используйте `npm run dev:portal` локально.

## Ручная сборка образов и деплой

Из корня репозитория:

```bash
bash scripts/k8s-build-images.sh
bash scripts/k8s-apply.sh
```

Windows (PowerShell):

```powershell
.\scripts\k8s-build-images.ps1
kubectl apply -k ./k8s
kubectl get pods -n alproject
```

Образы собираются локально; в манифестах `imagePullPolicy: IfNotPresent`, чтобы kube использовал движок Docker Desktop.

## Доступ

Сервисы **portal** и **hello-lab** объявлены как **LoadBalancer**: в **Docker Desktop** они обычно доступны на хосте по тем же портам, что и у Service.

| Сервис | Внутри кластера | С хоста (Docker Desktop) |
|---------|------------------|---------------------------|
| Portal | `portal:3000` | http://localhost:3000 |
| Agent hub gateway | `agent-hub-gateway:3010` | только изнутри сети Pod |
| Hello-lab | `hello-lab:3001` | http://localhost:3001 |

На некоторых установках Windows **NodePort** с `localhost` не работает — поэтому LoadBalancer предпочтительнее NodePort.

Если LoadBalancer не поднялся, прокиньте порт:

```bash
kubectl port-forward -n alproject svc/portal 3000:3000
```

и откройте http://localhost:3000

Секреты портала — в `portal-secret.yaml` (только для разработки).

### Вход в Agent Hub (`/agent-hub/login`)

Пароль задаётся в Kubernetes Secret `portal-env`, поле **`HUB_PASSWORD`**. По умолчанию в репозитории это **`dev-hub-password`** — он **не совпадает** с паролем из локального `.env`, если вы меняли его только у себя на диске.

После смены пароля в YAML примените заново: `kubectl apply -k k8s` и перезапустите под портала (`kubectl rollout restart deployment/portal -n alproject`) или пересоберите образ, если правили код.

Если пароль верный, но после входа снова форма логина: для HTTP без TLS в деплое выставлено **`HUB_COOKIE_SECURE=false`** (иначе браузер отбрасывает `Secure`-cookies при `NODE_ENV=production`).
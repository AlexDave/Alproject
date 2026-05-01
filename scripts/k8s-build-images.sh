#!/usr/bin/env bash
# Сборка образов для Kubernetes (те же Dockerfile, что и для docker compose).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "=== BUILD [alproject-portal] $ROOT ==="
docker build -t alproject-portal:latest -f apps/portal/Dockerfile .
echo "=== BUILD [alproject-agent-hub-gateway] ==="
docker build -t alproject-agent-hub-gateway:latest -f apps/agent-hub-gateway/Dockerfile .
echo "=== BUILD [alproject-hello-lab] ==="
docker build -t alproject-hello-lab:latest -f projects/js/hello-lab/Dockerfile projects/js/hello-lab
echo "Done."

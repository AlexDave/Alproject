#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
kubectl config use-context docker-desktop 2>/dev/null || true
kubectl apply -k "$ROOT/k8s"
echo "Pods:"
kubectl get pods -n alproject -o wide
echo ""
echo "Services (NodePort): portal http://localhost:30080 , hello-lab http://localhost:30081"

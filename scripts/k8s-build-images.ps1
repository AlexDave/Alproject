$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Write-Host "=== BUILD [alproject-portal] $Root ==="
docker build -t alproject-portal:latest -f apps/portal/Dockerfile .
Write-Host "=== BUILD [alproject-agent-hub-gateway] ==="
docker build -t alproject-agent-hub-gateway:latest -f apps/agent-hub-gateway/Dockerfile .
Write-Host "=== BUILD [alproject-hello-lab] ==="
docker build -t alproject-hello-lab:latest -f projects/js/hello-lab/Dockerfile projects/js/hello-lab
Write-Host "Done."

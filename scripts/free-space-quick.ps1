# Освобождение места без вызова npm (при ENOSPC команда npm не пишет даже лог).
# Запуск из cmd/PowerShell (скопируйте путь к репо):
#   powershell.exe -ExecutionPolicy Bypass -File D:\Project\Alproject\scripts\free-space-quick.ps1

$ErrorActionPreference = "SilentlyContinue"

function Show-FreeGB([string]$Name) {
  try {
    $d = Get-PSDrive $Name -ErrorAction Stop
    $gb = [math]::Round($d.Free / 1GB, 2)
    Write-Host "[alproject] Диск ${Name}: свободно ~ $gb GB"
  } catch {}
}

Show-FreeGB "C"
if (Get-PSDrive D -ErrorAction SilentlyContinue) { Show-FreeGB "D" }

Write-Host "[alproject] Очистка кэша npm ($env:LOCALAPPDATA\npm-cache)..."
$npmCache = Join-Path $env:LOCALAPPDATA "npm-cache"
if (Test-Path $npmCache) {
  Remove-Item -LiteralPath $npmCache -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "[alproject] npm-cache удалён."
} else {
  Write-Host "[alproject] npm-cache не найден."
}

$persistYarn = Join-Path $env:LOCALAPPDATA "Yarn"
if (Test-Path $persistYarn) {
  Write-Host "[alproject] Очистка AppData\Yarn\Cache (если есть)..."
  $yc = Join-Path $persistYarn "Cache"
  if (Test-Path $yc) {
    Remove-Item -LiteralPath $yc -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[alproject] Yarn Cache удалён."
  }
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
  Write-Host "[alproject] Docker: builder prune + system prune (без volumes)..."
  & docker builder prune -af 2>&1 | Out-Null
  & docker system prune -af 2>&1 | Out-Null
  Write-Host "[alproject] docker prune выполнен (или движок был недоступен)."
} else {
  Write-Host "[alproject] docker.exe не в PATH — пропуск prune."
}

Write-Host ""
Show-FreeGB "C"
Write-Host "[alproject] Если всё ещё мало места: Корзина, Параметры Windows — Память, Docker Desktop — Troubleshoot — Clean data."
Write-Host "[alproject] После docker prune файл docker_data.vhdx на диске часто не уменьшается — см. scripts/docker-vhdx-compact.ps1 (от администратора)."
# Не используйте exit — скрипт может вызываться через . из docker-desktop-recover-windows.ps1

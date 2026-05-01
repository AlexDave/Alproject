# Сжатие docker_data.vhdx / ext4.vhdx после удаления образов (файл на диске не уменьшается сам).
# Нужны права администратора. Docker Desktop должен быть закрыт.
#
# Перед сжатием имеет смысл освободить место ВНУТРИ Docker:
#   docker system prune -af
#   docker volume prune -f
#
# Запуск (PowerShell от имени администратора):
#   Set-Location D:\Project\Alproject
#   .\scripts\docker-vhdx-compact.ps1

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

function Stop-DockerDesktop {
  $names = @(
    "Docker Desktop", "com.docker.backend", "com.docker.build",
    "Docker Desktop Helper", "Docker Desktop Helper (GPU)"
  )
  foreach ($n in $names) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "com.docker*" } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

Write-Host "[alproject] Останавливаю Docker Desktop..."
Stop-DockerDesktop

Write-Host "[alproject] wsl --shutdown"
wsl.exe --shutdown 2>$null
Start-Sleep -Seconds 3

$root = Join-Path $env:LOCALAPPDATA "Docker\wsl"
if (-not (Test-Path $root)) {
  Write-Error "Не найден каталог: $root (Docker Desktop установлен?)"
  exit 1
}

$vhdis = Get-ChildItem -Path $root -Filter "*.vhdx" -Recurse -File -ErrorAction SilentlyContinue
if (-not $vhdis -or $vhdis.Count -eq 0) {
  Write-Error "В $root нет .vhdx. Проверьте путь данных Docker: Settings -> Resources -> Advanced."
  exit 1
}

foreach ($v in $vhdis) {
  $path = $v.FullName
  $sizeBefore = [math]::Round($v.Length / 1GB, 2)
  Write-Host ""
  Write-Host "[alproject] COMPACT: $path (~ $sizeBefore GB)"

  $lines = @(
    "select vdisk file=`"$path`"",
    "attach vdisk readonly",
    "compact vdisk",
    "detach vdisk"
  )
  $script = $lines -join "`n"
  $script | diskpart.exe | ForEach-Object { Write-Host "  diskpart: $_" }
}

Write-Host ""
Write-Host "[alproject] Готово. Запустите Docker Desktop вручную."
Write-Host "[alproject] Если диск всё ещё мал: Settings -> Resources -> Disk image location — перенесите на D:."
exit 0

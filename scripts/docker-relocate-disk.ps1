# Docker Desktop: move disk image to another drive (e.g. E:) via Settings UI.
# Encoding: UTF-8. Run: powershell -ExecutionPolicy Bypass -File scripts/docker-relocate-disk.ps1

param(
  [string]$TargetRoot = "E:\DockerDesktop"
)

$ErrorActionPreference = "Stop"

if (-not ($TargetRoot -match '^[A-Za-z]:\\')) {
  Write-Error "TargetRoot must be like E:\DockerDesktop"
  exit 1
}

$drive = $TargetRoot.Substring(0, 1).ToUpperInvariant()
$psDrive = Get-PSDrive -Name $drive -ErrorAction SilentlyContinue
if ($null -eq $psDrive) {
  Write-Error "Drive ${drive}: is not available."
  exit 1
}

New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
Write-Host "[alproject] Folder ready: $TargetRoot"
Write-Host ""

Write-Host "=== Move Docker Desktop data to drive $drive ==="
Write-Host ""
Write-Host "Step 1 - Quit Docker Desktop completely (tray icon - Quit)."
Write-Host ""
Write-Host "Step 2 - Ensure drive $drive has enough free space (add 20-30 GB headroom vs current docker_data.vhdx)."
Write-Host ""
Write-Host "Step 3 - Start Docker Desktop again."
Write-Host ""
Write-Host "Step 4 - Open Settings - Resources - Advanced (or Disk image / Virtual disk)."
Write-Host "         Find Disk image location."
Write-Host ""
Write-Host "Step 5 - Browse and select this folder:"
Write-Host "         $TargetRoot"
Write-Host "         Docker will create its disk file inside."
Write-Host ""
Write-Host "Step 6 - Apply and restart. Wait until migration finishes."
Write-Host ""
Write-Host "Step 7 - Test: docker run hello-world"
Write-Host ""
Write-Host "Step 8 - Old vhdx on C: under %LOCALAPPDATA%\Docker\wsl may be removed by Docker."
Write-Host "         Delete manually only after you confirmed everything works from the new path."
Write-Host ""
Write-Host "Advanced: manual WSL export/import of docker-desktop-data - for experts only."
Write-Host ""

exit 0

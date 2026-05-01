# Recover Docker Desktop after Engine hang (see k8s/README.md).
# Run: powershell -ExecutionPolicy Bypass -File scripts/docker-desktop-recover-windows.ps1
# При ошибке npm ENOSPC сначала (без npm): powershell -File scripts/free-space-quick.ps1

$ErrorActionPreference = "Continue"

$freeScript = Join-Path $PSScriptRoot "free-space-quick.ps1"
if (Test-Path $freeScript) {
  Write-Host "[alproject] Step 0: освобождение места (npm-cache, docker prune)..."
  & $freeScript
  Write-Host ""
}

function Stop-AlprojectDockerProcesses {
  Write-Host "[alproject] Step 1: stopping Docker Desktop processes (force)..."
  $names = @(
    "Docker Desktop",
    "Docker Desktop Helper",
    "Docker Desktop Helper (GPU)",
    "com.docker.backend",
    "com.docker.build",
    "com.docker.diagnose",
    "com.docker.dev-envs",
    "vpnkit-bridge",
    "vpnkit-forwarder",
    "vpnkit-expose-port",
    "vpnkit-proxy",
    "vpnkit"
  )
  foreach ($n in $names) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
      Write-Host ("  stop: " + $_.ProcessName + " (pid " + $_.Id + ")")
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
  }
  # Remaining com.docker.* / vpnkit*
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -like "com.docker*" -or $_.ProcessName -like "vpnkit*"
  } | ForEach-Object {
    Write-Host ("  stop: " + $_.ProcessName + " (pid " + $_.Id + ")")
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
  # taskkill fallback (names with spaces)
  $ims = @("Docker Desktop.exe", "com.docker.backend.exe")
  foreach ($im in $ims) {
    & taskkill.exe /F /IM $im /T 2>$null | Out-Null
  }
  Start-Sleep -Seconds 2
}

Stop-AlprojectDockerProcesses

Write-Host "[alproject] Step 2: wsl --shutdown ..."
wsl --shutdown 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[alproject] Note: wsl exit code $LASTEXITCODE (ok if WSL unused)."
}

Start-Sleep -Seconds 1

$possible = @(
  "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe",
  "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
  "${env:LocalAppData}\Docker\Docker Desktop.exe"
)

$exe = $possible | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $exe) {
  Write-Host "[alproject] Docker Desktop.exe not found. Install Docker Desktop."
  exit 1
}

Write-Host "[alproject] Step 3: starting Docker Desktop: $exe"
Start-Process -FilePath $exe

Write-Host ""
Write-Host "[alproject] Wait for Engine ready (about 1-3 min)."
Write-Host "[alproject] If stuck: Docker Desktop - Troubleshoot - Restart or Reset to factory defaults."
Write-Host "[alproject] Verify: docker info"
exit 0

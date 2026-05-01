/**
 * Проверка `docker info`. На Windows может автоматически запустить Docker Desktop.exe
 * и ждать поднятия daemon (переменные см. ниже).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

/** Таймаут сек — при недоступном daemon `docker info` может висеть очень долго. */
const DOCKER_INFO_TIMEOUT_MS = Number.parseInt(process.env.DOCKER_INFO_TIMEOUT_MS ?? "12000", 10);

function dockerInfoOk() {
  const r = spawnSync("docker", ["info"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: DOCKER_INFO_TIMEOUT_MS,
    killSignal: "SIGTERM",
    windowsHide: true,
  });
  return r.status === 0 && !r.error;
}

function dockerDesktopPaths() {
  const out = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env["ProgramFiles(x86)"];
  const local = process.env.LocalAppData;
  if (pf) out.push(`${pf}\\Docker\\Docker\\Docker Desktop.exe`);
  if (pf86) out.push(`${pf86}\\Docker\\Docker\\Docker Desktop.exe`);
  out.push("C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe");
  if (local) out.push(`${local}\\Docker\\Docker Desktop.exe`);
  return [...new Set(out)].filter((p) => existsSync(p));
}

function tryLaunchDockerDesktop() {
  const paths = dockerDesktopPaths();
  if (paths.length === 0) {
    console.error("[alproject] Docker Desktop.exe не найден в стандартных путях. Установите Docker Desktop.");
    return false;
  }
  const exe = paths[0];
  console.log(`[alproject] Запускаю Docker Desktop: ${exe}`);
  try {
    const child = spawn(exe, [], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch (e) {
    console.error("[alproject] Не удалось запустить Docker Desktop:", e instanceof Error ? e.message : e);
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (dockerInfoOk()) {
    console.log("[alproject] Docker OK (docker info)");
    return;
  }

  const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  const autostartOff =
    process.env.DOCKER_DESKTOP_AUTOSTART === "0" || /^false$/i.test(process.env.DOCKER_DESKTOP_AUTOSTART ?? "");
  const tryGui = platform() === "win32" && !isCi && !autostartOff;

  if (tryGui && tryLaunchDockerDesktop()) {
    const maxMs = Number.parseInt(process.env.DOCKER_DESKTOP_WAIT_MS ?? "120000", 10);
    const step = 4000;
    for (let waited = 0; waited < maxMs; waited += step) {
      await sleep(step);
      if (dockerInfoOk()) {
        console.log("[alproject] Docker OK — daemon поднялся после запуска Docker Desktop");
        return;
      }
      const sec = Math.min(Math.round((waited + step) / 1000), Math.round(maxMs / 1000));
      process.stdout.write(`[alproject] Ожидание docker daemon… ~${sec}s / ${Math.round(maxMs / 1000)}s\n`);
    }
  }

  console.error(
    "[alproject] Docker daemon недоступен (pipe dockerDesktopLinuxEngine). Варианты:",
  );
  console.error("  • Запустите Docker Desktop вручную из меню Пуск и дождитесь готовности в трее.");
  console.error("  • PowerShell (админ): wsl --update && wsl --shutdown — затем снова Docker Desktop.");
  console.error("  • Отключить авто-запуск GUI: DOCKER_DESKTOP_AUTOSTART=0");
  console.error("  • Увеличить ожидание: DOCKER_DESKTOP_WAIT_MS=300000");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

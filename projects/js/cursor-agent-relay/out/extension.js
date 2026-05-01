"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const child_process_1 = require("child_process");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const SECRET_HUB = 'cursorAgentRelay.hubIngestSecret';
let relayProcess = null;
let outputChannel;
let statusItem;
function getConfig() {
    return vscode.workspace.getConfiguration('cursorAgentRelay');
}
function resolveAgentDirectory() {
    const explicit = getConfig().get('agentDirectory')?.trim();
    if (explicit) {
        const abs = path.isAbsolute(explicit) ? explicit : path.resolve(explicit);
        return abs;
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder)
        return undefined;
    return path.join(folder, 'projects', 'js', 'cursor-agent-telegram');
}
function isAgentPackage(dir) {
    try {
        const pkgPath = path.join(dir, 'package.json');
        if (!fs.existsSync(pkgPath))
            return false;
        const raw = fs.readFileSync(pkgPath, 'utf8');
        const j = JSON.parse(raw);
        return j.name === '@alproject/cursor-agent-telegram';
    }
    catch {
        return false;
    }
}
function updateStatusBar() {
    const running = relayProcess !== null && !relayProcess.killed;
    if (running) {
        statusItem.text = '$(radio-tower) Relay';
        statusItem.tooltip = 'Relay запущен (npm run start). Нажмите — меню.';
    }
    else {
        statusItem.text = '$(debug-disconnect) Relay выкл';
        statusItem.tooltip = 'Relay не запущен. Нажмите — меню.';
    }
    statusItem.show();
}
async function checkCdp() {
    const base = getConfig().get('cdpUrl')?.replace(/\/$/, '') ?? 'http://127.0.0.1:9222';
    const url = `${base}/json`;
    try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 4000);
        const r = await fetch(url, { signal: ac.signal });
        clearTimeout(t);
        if (!r.ok) {
            vscode.window.showErrorMessage(`CDP: HTTP ${r.status} (${url})`);
            return;
        }
        const data = await r.json();
        const n = Array.isArray(data) ? data.length : 0;
        if (!Array.isArray(data)) {
            vscode.window.showErrorMessage('CDP: ответ не JSON-массив — проверьте URL и флаг --remote-debugging-port=9222');
            return;
        }
        vscode.window.showInformationMessage(`CDP доступен: ${n} целей (${base})`);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`CDP недоступен (${url}): ${msg}. Запустите Cursor с отладкой или команду «Подсказка: запуск Cursor с отладкой».`);
    }
}
async function setHubSecret(context) {
    const has = Boolean(await context.secrets.get(SECRET_HUB));
    const value = await vscode.window.showInputBox({
        title: 'HUB_INGEST_SECRET',
        prompt: has
            ? 'Новый секрет (как в apps/portal .env — HUB_INGEST_SECRET)'
            : 'Секрет как в apps/portal (.env — HUB_INGEST_SECRET)',
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (!v || v.length < 8 ? 'Минимум 8 символов' : null),
    });
    if (value === undefined || !value)
        return;
    await context.secrets.store(SECRET_HUB, value);
    vscode.window.showInformationMessage('Секрет Hub сохранён в Secret Storage расширения.');
}
function buildRelayEnv(context) {
    const env = { ...process.env };
    const hubUrl = getConfig().get('hubUrl')?.trim();
    if (hubUrl)
        env.HUB_URL = hubUrl;
    const cdp = getConfig().get('cdpUrl')?.trim();
    if (cdp)
        env.CDP_URL = cdp;
    const port = getConfig().get('agentControlPort')?.trim();
    if (port)
        env.AGENT_CONTROL_PORT = port;
    const wf = vscode.workspace.workspaceFolders?.[0];
    if (wf)
        env.CURSOR_WORKSPACE_PATH = wf.uri.fsPath;
    return env;
}
async function startRelay(context) {
    if (relayProcess && !relayProcess.killed) {
        vscode.window.showWarningMessage('Relay уже запущен.');
        return;
    }
    const agentDir = resolveAgentDirectory();
    if (!agentDir) {
        vscode.window.showErrorMessage('Откройте папку воркспейса (монорепозиторий) или задайте cursorAgentRelay.agentDirectory.');
        return;
    }
    if (!isAgentPackage(agentDir)) {
        vscode.window.showErrorMessage(`Не найден пакет @alproject/cursor-agent-telegram в «${agentDir}». Проверьте agentDirectory.`);
        return;
    }
    const distMain = path.join(agentDir, 'dist', 'index.js');
    if (!fs.existsSync(distMain)) {
        const pick = await vscode.window.showWarningMessage('Нет dist/index.js. Сначала: npm run build в projects/js/cursor-agent-telegram', 'Открыть папку агента');
        if (pick === 'Открыть папку агента') {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(agentDir));
        }
        return;
    }
    const secret = await context.secrets.get(SECRET_HUB);
    const hubUrl = getConfig().get('hubUrl')?.trim();
    if (hubUrl && !secret) {
        const go = await vscode.window.showWarningMessage('Задан HUB_URL, но секрет Hub пуст. Ingest на портале вернёт 401.', 'Задать секрет', 'Запустить всё равно');
        if (go === 'Задать секрет') {
            await setHubSecret(context);
            if (!(await context.secrets.get(SECRET_HUB)))
                return;
        }
        else if (go !== 'Запустить всё равно') {
            return;
        }
    }
    const env = buildRelayEnv(context);
    const s = await context.secrets.get(SECRET_HUB);
    if (s)
        env.HUB_INGEST_SECRET = s;
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    outputChannel.appendLine(`[relay] cwd=${agentDir}`);
    outputChannel.appendLine(`[relay] ${npm} run start`);
    try {
        const proc = (0, child_process_1.spawn)(npm, ['run', 'start'], {
            cwd: agentDir,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        relayProcess = proc;
        proc.stdout?.on('data', (buf) => outputChannel.append(buf.toString('utf8')));
        proc.stderr?.on('data', (buf) => outputChannel.append(buf.toString('utf8')));
        proc.on('exit', (code, signal) => {
            outputChannel.appendLine(`[relay] exit code=${code} signal=${signal ?? ''}`);
            if (relayProcess === proc)
                relayProcess = null;
            updateStatusBar();
        });
        proc.on('error', (err) => {
            vscode.window.showErrorMessage(`Relay: ${err.message}`);
            if (relayProcess === proc)
                relayProcess = null;
            updateStatusBar();
        });
        updateStatusBar();
        vscode.window.showInformationMessage('Relay запущен (см. вывод в канале «Cursor Agent Relay»).');
        outputChannel.show(true);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Не удалось запустить relay: ${msg}`);
    }
}
function stopRelay() {
    if (!relayProcess || relayProcess.killed) {
        vscode.window.showInformationMessage('Relay не запущен.');
        return;
    }
    relayProcess.kill('SIGTERM');
    relayProcess = null;
    updateStatusBar();
    vscode.window.showInformationMessage('Отправлен SIGTERM процессу relay.');
}
async function quickMenu(context) {
    const items = [
        { label: '$(debug-start) Запустить relay', cmd: 'cursor-agent-relay.startRelay' },
        { label: '$(debug-stop) Остановить relay', cmd: 'cursor-agent-relay.stopRelay' },
        { label: '$(globe) Проверить CDP', cmd: 'cursor-agent-relay.checkCdp' },
        { label: '$(key) Задать секрет Hub', cmd: 'cursor-agent-relay.setHubSecret' },
        { label: '$(output) Открыть лог relay', cmd: 'cursor-agent-relay.showOutput' },
        { label: '$(info) Подсказка: Cursor +9222', cmd: 'cursor-agent-relay.showCdpHint' },
    ];
    const picked = await vscode.window.showQuickPick(items, { title: 'Cursor Agent Relay' });
    if (picked)
        await vscode.commands.executeCommand(picked.cmd);
}
function showCdpHint() {
    const isWin = process.platform === 'win32';
    const line = isWin
        ? 'PowerShell: & "$env:LOCALAPPDATA\\Programs\\cursor\\Cursor.exe" --remote-debugging-port=9222'
        : 'Закройте Cursor и запустите с флагом: --remote-debugging-port=9222 (путь к бинарнику см. в документации ОС).';
    void vscode.window.showInformationMessage(line, 'Копировать').then((c) => {
        if (c === 'Копировать')
            void vscode.env.clipboard.writeText(line);
    });
}
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('Cursor Agent Relay');
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    statusItem.command = 'cursor-agent-relay.quickMenu';
    updateStatusBar();
    context.subscriptions.push(outputChannel, statusItem, vscode.commands.registerCommand('cursor-agent-relay.startRelay', () => void startRelay(context)), vscode.commands.registerCommand('cursor-agent-relay.stopRelay', stopRelay), vscode.commands.registerCommand('cursor-agent-relay.checkCdp', () => void checkCdp()), vscode.commands.registerCommand('cursor-agent-relay.setHubSecret', () => void setHubSecret(context)), vscode.commands.registerCommand('cursor-agent-relay.showOutput', () => outputChannel.show(true)), vscode.commands.registerCommand('cursor-agent-relay.showCdpHint', showCdpHint), vscode.commands.registerCommand('cursor-agent-relay.quickMenu', () => void quickMenu(context)));
}
function deactivate() {
    if (relayProcess && !relayProcess.killed) {
        relayProcess.kill('SIGTERM');
    }
    relayProcess = null;
}
//# sourceMappingURL=extension.js.map
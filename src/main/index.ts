import { app, BrowserWindow, Menu } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Store from 'electron-store';
import { envKeyOf } from '@shared/types/env';
import { appOrigins, createMainWindow } from './window';
import { PortHub, registerIpc, sendInfo } from './ipc/register';
import { openDb } from './persistence/db';
import { HistoryRepo } from './persistence/history-repo';
import { PrefsStore } from './persistence/prefs';
import { SessionRepo } from './persistence/session-repo';
import { WorkerPtyBackend } from './pty/pty-worker-backend';
import { SessionManager } from './pty/session-manager';
import { ProfileRegistry } from './shell/registry';
import { WslManager } from './wsl/wsl-manager';
import { AgentManager } from './agents/agent-manager';
import { CompletionEngine } from './completion/engine';
import { EnvironmentQueryService } from './env-query/service';
import { setResourcesDir } from './paths';
import { logger } from './logger';
import { mark, timing } from './timing';

// Tests run with an isolated profile so they never touch (or lock) the real one.
if (process.env['AGENTDOCK_USER_DATA']) app.setPath('userData', process.env['AGENTDOCK_USER_DATA']);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function runSmoke(sessions: SessionManager, registry: ProfileRegistry, outFile: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  let result: Record<string, unknown> = { ok: false, reason: 'timeout' };
  while (Date.now() < deadline) {
    const s = sessions.list().find((x) => x.integration === 'active' && x.phase === 'editing');
    if (s) {
      const native: Record<string, unknown> = {};
      try {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(':memory:');
        native['sqlite'] = (db.prepare('select sqlite_version() v').get() as { v: string }).v;
        db.close();
      } catch (e) {
        native['sqliteError'] = String(e);
      }
      result = {
        ok: !native['sqliteError'],
        timingMs: { ...timing, prompt: Math.round(process.uptime() * 1000) },
        version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged,
        profiles: registry.snapshot().profiles.map((p) => p.id),
        session: { shell: s.shell, integration: s.integration, phase: s.phase, cwd: s.cwd?.path, pid: s.pid },
        native
      };
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  writeFileSync(outFile, JSON.stringify(result));
  if (!result['ok']) process.exitCode = 1;
  app.quit();
}

async function start(): Promise<void> {
  if (app.isPackaged) setResourcesDir(process.resourcesPath);
  app.setAppUserModelId('dev.agentdock.app');
  Menu.setApplicationMenu(null);
  await app.whenReady();
  mark('appReady');

  const store = new Store<{ prefs: unknown }>({ name: 'preferences' });
  const prefs = new PrefsStore({ get: () => store.get('prefs'), set: (v) => store.set('prefs', v) });
  const { db, recovered } = openDb(join(app.getPath('userData'), 'agentdock.db'));
  if (recovered) logger.warn('database was corrupt and has been recreated');
  const history = new HistoryRepo(db, prefs.get().historyLimit);
  const sessionRepo = new SessionRepo(db);
  const wsl = new WslManager();
  const registry = new ProfileRegistry(wsl);
  mark('storesOpen');
  // Windows shells are known at once; WSL is probed in the background so it never delays the window.
  registry.startBackgroundRefresh();

  let win: BrowserWindow | undefined;
  const hub = new PortHub(() => win);

  const startupSaved = prefs.get().restoreTabs ? sessionRepo.load().filter((x) => x.kind === 'shell') : [];
  const agents = new AgentManager(wsl, registry, () => prefs.get().agentPaths);
  const envQuery = new EnvironmentQueryService();

  const warmed = new Set<string>();
  const sessions = new SessionManager({
    agentLaunch: (spec) => agents.launch(spec),
    wslBranch: (cwd) => envQuery.gitBranch({ kind: 'wsl', distro: cwd.distro }, cwd.path),
    backend: new WorkerPtyBackend(join(import.meta.dirname, 'pty-worker.js'), prefs.get().conptyMode === 'bundled'),
    getProfile: (id) => registry.get(id),
    toPosix: (d, p) => wsl.toPosix(d, p),
    onData: (id, chunk) => hub.send(id, chunk),
    onInfo: (info) => {
      if (info.state === 'running') mark('shellSpawned');
      if (info.integration === 'active') {
        mark('shellHello');
        // the first completion should not have to scan PATH: do it now, once per environment
        const key = info.env.kind === 'windows' ? 'windows' : info.env.distro;
        if (!warmed.has(key)) {
          warmed.add(key);
          void envQuery.listExecutables(info.env).catch(() => undefined);
        }
      }
      if (info.phase === 'editing') mark('shellPrompt');
      sendInfo(win, info);
    },
    onClosed: (id) => {
      hub.detach(id);
      if (win && !win.isDestroyed()) win.webContents.send('session:closed', id);
    },
    onCommand: (c) => {
      const p = registry.get(c.profileId);
      if (!p) return;
      history.record({
        envKey: envKeyOf(p.env, p.shell), command: c.command, at: c.endedAt,
        ...(c.cwd ? { cwd: c.cwd.path } : {}), ...(c.exitCode !== undefined ? { exitCode: c.exitCode } : {})
      });
    }
  });

  const completion = new CompletionEngine({ sessions, history, env: envQuery });

  registerIpc(
    {
      sessions, registry, prefs, history, completion, envQuery, wsl,
      agents: { detect: (refresh) => agents.detect(refresh) },
      savedSessions: () => startupSaved,
      onPrefsChanged: (p) => {
        const dark = p.theme === 'dark';
        win?.setTitleBarOverlay({ color: dark ? '#0e0f13' : '#fbfbfd', symbolColor: dark ? '#c9ccd6' : '#23252e' });
      },
      diagnostics: () => ({
        app: app.getVersion(), electron: process.versions.electron, node: process.versions.node,
        e2e: !!process.env['AGENTDOCK_E2E'],
        os: process.getSystemVersion(), arch: process.arch, conptyMode: prefs.get().conptyMode,
        profiles: registry.snapshot().profiles.map((p) => p.id), wsl: registry.snapshot().wsl
      }),
      getWindow: () => win,
      origins: appOrigins
    },
    hub
  );

  const create = () => {
    win = createMainWindow(prefs, {
      busyCount: () => sessions.list().filter((s) => s.state === 'running' && (s.kind === 'agent' || s.phase === 'executing')).length
    });
    win.on('closed', () => (win = undefined));
    win.once('ready-to-show', () => mark('windowShown'));
  };
  create();

  // Used by scripts/smoke-installed.mjs to check a built or installed app without a debugger.
  if (process.env['AGENTDOCK_SMOKE_OUT']) void runSmoke(sessions, registry, process.env['AGENTDOCK_SMOKE_OUT']);

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());

  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    try {
      sessionRepo.saveAll(sessions.list());
    } catch (err) {
      logger.error('saving sessions failed', err);
    }
    void sessions.closeAll(5000).finally(() => {
      envQuery.dispose();
      db.close();
      app.quit();
    });
  });
}

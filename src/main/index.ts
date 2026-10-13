import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Store from 'electron-store';
import { envKeyOf } from '@shared/types/env';
import { appOrigins, createMainWindow } from './window';
import { PortHub, registerIpc, sendInfo } from './ipc/register';
import { openDb } from './persistence/db';
import { HistoryRepo } from './persistence/history-repo';
import { PrefsStore } from './persistence/prefs';
import { migrateLegacyUserData } from './persistence/migrate-legacy';
import { SessionRepo } from './persistence/session-repo';
import { WorkerPtyBackend } from './pty/pty-worker-backend';
import { SessionManager } from './pty/session-manager';
import type { WslDistro } from '@shared/types/wsl';
import { ProfileRegistry } from './shell/registry';
import { WslManager } from './wsl/wsl-manager';
import { AgentManager } from './agents/agent-manager';
import { CompletionEngine } from './completion/engine';
import { EnvironmentQueryService } from './env-query/service';
import { installAppMenu } from './app-menu';
import { setResourcesDir } from './paths';
import { logger } from './logger';
import { mark, timing } from './timing';

// Tests run with an isolated profile so they never touch (or lock) the real one. So does a development run (`npm run dev`):
// the single-instance lock, the database and the preferences all live in the profile folder, and sharing it with an installed
// Arctri would make whichever starts second quit at once.
const customProfile = !!process.env['ARCTRI_USER_DATA'] || !app.isPackaged;
if (process.env['ARCTRI_USER_DATA']) app.setPath('userData', process.env['ARCTRI_USER_DATA']);
else if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')}-dev`);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function runSmoke(sessions: SessionManager, registry: ProfileRegistry, outFile: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  let result: Record<string, unknown> = { ok: false, reason: 'timeout' };
  let started = false;
  while (Date.now() < deadline) {
    // A fresh profile has no tabs to restore and the window shows the welcome page, so there is no shell to wait for: open one.
    if (!started && Date.now() > deadline - 85_000 && sessions.list().length === 0) {
      started = true;
      const all = (await registry.refresh(false)).profiles;
      const profile = all.find((p) => p.id === 'pwsh') ?? all.find((p) => p.id === 'local:zsh') ?? all.find((p) => !p.id.startsWith('wsl:'));
      if (profile) {
        await sessions.create({ profileId: profile.id, kind: 'shell', cols: 100, rows: 30, presentation: 'blocks' }).catch((e) => logger.error('smoke shell failed', e));
      }
    }
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
  if (!result['ok']) {
    // say what the app did see, so a timeout on a bare CI machine is not a blank
    result = {
      ...result,
      sessions: sessions.list().map((x) => ({ shell: x.shell, state: x.state, phase: x.phase, integration: x.integration, kind: x.kind, ...(x.exit ? { exit: x.exit } : {}) })),
      profiles: registry.snapshot().profiles.map((p) => p.id)
    };
  }
  writeFileSync(outFile, JSON.stringify(result));
  if (!result['ok']) process.exitCode = 1;
  app.quit();
}

async function start(): Promise<void> {
  if (app.isPackaged) setResourcesDir(process.resourcesPath);
  app.setAppUserModelId('dev.arctri.app');
  installAppMenu();
  await app.whenReady();
  mark('appReady');

  if (!customProfile) migrateLegacyUserData(app.getPath('userData'), app.getPath('appData'));
  const store = new Store<{ prefs: unknown; wslZsh: Record<string, boolean>; wslDistros: WslDistro[] }>({ name: 'preferences' });
  const prefs = new PrefsStore({ get: () => store.get('prefs'), set: (v) => store.set('prefs', v) });
  const { db, recovered } = openDb(join(app.getPath('userData'), 'arctri.db'));
  if (recovered) logger.warn('database was corrupt and has been recreated');
  const history = new HistoryRepo(db, prefs.get().historyLimit);
  const sessionRepo = new SessionRepo(db);
  const wsl = new WslManager();
  const registry = new ProfileRegistry(wsl, {
    zsh: {
      get: () => (store.get('wslZsh') as Record<string, boolean> | undefined) ?? {},
      set: (v) => store.set('wslZsh', v)
    },
    distros: {
      get: () => (store.get('wslDistros') as WslDistro[] | undefined) ?? [],
      set: (v) => store.set('wslDistros', v)
    }
  });
  mark('storesOpen');
  // Windows shells are known at once; WSL is probed in the background so it never delays the window.
  registry.startBackgroundRefresh();

  let win: BrowserWindow | undefined;
  const hub = new PortHub(() => win);

  const startupSaved = sessionRepo.load().filter((x) => x.kind === 'shell');
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
        const key = info.env.kind === 'wsl' ? info.env.distro : info.env.kind;
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
        if (process.platform !== 'darwin') win?.setTitleBarOverlay({ color: dark ? '#15171d' : '#f1f2f6', symbolColor: dark ? '#c9ccd6' : '#23252e' });
      },
      diagnostics: () => ({
        app: app.getVersion(), electron: process.versions.electron, node: process.versions.node,
        e2e: !!process.env['ARCTRI_E2E'],
        welcome: !!process.env['ARCTRI_E2E_WELCOME'],
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
  if (process.env['ARCTRI_SMOKE_OUT']) void runSmoke(sessions, registry, process.env['ARCTRI_SMOKE_OUT']);

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

import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Store from 'electron-store';
import { sweepPastes } from './files/attachments';
import { envKeyOf } from '@shared/types/env';
import { appOrigins, approveQuit, confirmEndRunning, createMainWindow } from './window';
import { PortHub, registerIpc, sendInfo } from './ipc/register';
import { FileWatcher } from './files/watcher';
import { GitSyncService } from './git/sync-service';
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
import { AgentStatusService } from './agents/status-service';
import { buildShellStatusEnv } from './agents/status/shell-env';
import { CompletionEngine } from './completion/engine';
import { EnvironmentQueryService } from './env-query/service';
import { installAppMenu } from './app-menu';
import { hookScript, setResourcesDir } from './paths';
import { logger } from './logger';
import { createUpdateService } from './update/create';
import { runUpdateSmoke } from './update/smoke';
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

// A bug in one corner must not take the sessions down with it; the log keeps what happened.
process.on('uncaughtException', (err) => logger.error('uncaught exception', err));
process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', reason instanceof Error ? reason : { reason: String(reason) }));

async function start(): Promise<void> {
  if (app.isPackaged) setResourcesDir(process.resourcesPath);
  app.setAppUserModelId('dev.arctri.app');
  installAppMenu();
  await app.whenReady();
  void sweepPastes();
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
  const fileWatcher = new FileWatcher((id, dirs) => {
    if (win && !win.isDestroyed()) win.webContents.send('fs:changed', { id, dirs });
  });

  const gitSyncRef: { current?: GitSyncService } = {};
  const agentStatus = new AgentStatusService({
    root: join(app.getPath('userData'), 'agent-events'),
    log: (message, extra) => logger.info(message, extra),
    acceptsEvents: (id) => {
      const i = sessions.get(id);
      return !!i && (i.kind === 'agent' || !!i.runningAgent);
    },
    windowFocused: () => !!win && !win.isDestroyed() && win.isFocused(),
    onActivity: (id, activity) => sessions.setActivity(id, activity),
    transcriptFile: (id, p) => {
      const env = sessions.get(id)?.env;
      if (!env) return null;
      return env.kind === 'wsl' ? `\\\\wsl.localhost\\${env.distro}${p.replace(/\//g, '\\')}` : env.kind === 'local' ? p : null;
    },
    onChanged: (status, id) => {
      if (win && !win.isDestroyed()) win.webContents.send('agentStatus:changed', { id, status });
      gitSyncRef.current?.agentChanged(id);
    }
  });

  const warmed = new Set<string>();
  const attachedAt = new Map<string, string>();
  const sessions = new SessionManager({
    log: (level, msg, detail) => logger[level](msg, detail),
    agentLaunch: async (spec, ctx) => {
      const eventsDir = agentStatus.watch(ctx.id, ctx.nonce);
      try {
        const launch = await agents.launch(spec, { ...ctx, eventsDir, settingsPath: agentStatus.settingsPath(ctx.id) });
        agentStatus.begin(ctx.id, launch.agentId, launch.statusHooks ? undefined : (launch.noHooksReason ?? 'no-hooks-cli'));
        return launch;
      } catch (e) {
        agentStatus.forget(ctx.id);
        throw e;
      }
    },
    shellStatusEnv: async (c) => {
      const eventsDir = agentStatus.watch(c.id, c.nonce);
      const env = await buildShellStatusEnv({
        env: c.env, shell: c.shell, nonce: c.nonce, eventsDir, settingsPath: agentStatus.settingsPath(c.id),
        script: hookScript(), toPosix: (d, p) => wsl.toPosix(d, p)
      });
      if (env) agentStatus.expectHooks(c.id);
      else {
        agentStatus.forget(c.id);
        agentStatus.noHooks(c.id, c.env.kind === 'windows' ? 'no-hooks-windows' : 'no-hooks-shell');
      }
      return env;
    },
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
      if (info.kind === 'agent' && info.agentId && (info.state === 'exited' || info.state === 'failed')) agentStatus.exited(info.id, info.agentId, info.state === 'failed' ? -1 : info.exit?.code);
      else if (info.kind === 'shell') {
        if (!info.runningAgent) agentStatus.clearSoon(info.id); // the agent typed into this tab has ended
        else {
          agentStatus.cancelClear(info.id);
          if (!agentStatus.has(info.id)) agentStatus.begin(info.id, info.runningAgent.agentId, agentStatus.noHooksReason(info.id));
        }
      }
      const here = info.cwd ? `${info.cwd.env}:${info.cwd.path}` : '';
      if (here && attachedAt.get(info.id) !== here) {
        attachedAt.set(info.id, here);
        void gitSyncRef.current?.attach(info.id);
      }
      sendInfo(win, info);
    },
    onClosed: (id) => {
      hub.detach(id);
      agentStatus.forget(id);
      fileWatcher.clear(id);
      attachedAt.delete(id);
      gitSyncRef.current?.detach(id);
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

  const send = (channel: string, payload: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const gitSync = new GitSyncService({
    session: (id) => {
      const i = sessions.get(id);
      return i?.cwd ? { env: i.env, cwd: i.cwd.path } : undefined;
    },
    agentActivity: (id) => {
      const i = sessions.get(id);
      if (!i || i.state === 'exited' || i.state === 'failed' || (i.kind !== 'agent' && !i.runningAgent)) return 'idle';
      const st = agentStatus.list().find((a) => a.sessionId === id)?.state;
      if (!st || st === 'unknown') return 'unknown';
      return st === 'working' || st === 'needs-approval' || st === 'starting' ? 'active' : 'idle';
    },
    emit: send,
    refreshBranch: (id) => sessions.refreshBranch(id),
    autoFetch: () => prefs.get().gitAutoFetch,
    signature: (env, cwd) => envQuery.gitSignature(env, cwd)
  });

  gitSyncRef.current = gitSync;
  // Running work: agent tabs, and shells with a command executing. Closing the window and installing an update both ask first.
  const busyCount = () => sessions.busyCount();
  // Saving the tabs and ending every session: once, whichever comes first (quitting, or an update about to install).
  let ended: Promise<void> | undefined;
  const endSessions = (): Promise<void> =>
    (ended ??= (async () => {
      try {
        sessionRepo.saveAll(sessions.list());
      } catch (err) {
        logger.error('saving sessions failed', err);
      }
      await sessions.closeAll(5000);
    })());
  // An update the user confirmed ends the sessions before the installer starts, so the installer never finds the app still closing them.
  const update = createUpdateService({
    busyCount,
    emit: send,
    onInstall: () => {
      approveQuit();
      return endSessions();
    }
  });
  update.configure(prefs.get().updates);
  const completion = new CompletionEngine({ sessions, history, env: envQuery });

  registerIpc(
    {
      sessions, registry, prefs, history, completion, envQuery, fileWatcher, gitSync, wsl, agentStatus, update,
      agents: { detect: (refresh) => agents.detect(refresh) },
      savedSessions: () => startupSaved,
      onPrefsChanged: (p) => {
        update.configure(p.updates);
        const dark = p.theme === 'dark';
        if (process.platform !== 'darwin') win?.setTitleBarOverlay({ color: dark ? '#15171d' : '#f1f2f6', symbolColor: dark ? '#c9ccd6' : '#23252e' });
      },
      diagnostics: () => ({
        app: app.getVersion(), electron: process.versions.electron, node: process.versions.node,
        e2e: !!process.env['ARCTRI_E2E'],
        welcome: !!process.env['ARCTRI_E2E_WELCOME'],
        os: process.getSystemVersion(), arch: process.arch, conptyMode: prefs.get().conptyMode,
        profiles: registry.snapshot().profiles.map((p) => p.id), wsl: registry.snapshot().wsl,
        agentStatus: { droppedEvents: agentStatus.dropped() }
      }),
      getWindow: () => win,
      origins: appOrigins
    },
    hub
  );

  const create = () => {
    win = createMainWindow(prefs, {
      busyCount
    });
    win.on('closed', () => (win = undefined));
    win.on('focus', () => gitSync.setFocused(true));
    win.on('blur', () => gitSync.setFocused(false));
    win.once('ready-to-show', () => mark('windowShown'));
  };
  create();

  // Used by scripts/smoke-installed.mjs to check a built or installed app without a debugger.
  if (process.env['ARCTRI_SMOKE_OUT']) void runSmoke(sessions, registry, process.env['ARCTRI_SMOKE_OUT']);
  // Used by scripts/smoke-update.mjs: the update path of an installed build, against a loopback feed.
  const updateSmokeOut = process.env['ARCTRI_SMOKE_UPDATE_OUT'];
  if (updateSmokeOut && app.isPackaged) void runUpdateSmoke(update, updateSmokeOut, process.env['ARCTRI_SMOKE_UPDATE_INSTALL'] === '1');

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
    // Ask first: by the time the window's own close prompt would run, the sessions would already be closed.
    if (!confirmEndRunning(win, busyCount())) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    quitting = true;
    void endSessions().finally(() => {
      update.dispose();
      fileWatcher.dispose();
      gitSync.dispose();
      envQuery.dispose();
      db.close();
      app.quit();
    });
  });
}

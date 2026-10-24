import { dialog, Notification, shell, MessageChannelMain, type BrowserWindow, type MessagePortMain } from 'electron';
import type { SessionInfo, SessionSpec } from '@shared/types/session';
import { envKeyOf } from '@shared/types/env';
import type { CompletionResponse } from '@shared/types/completion';
import type { AgentEntry } from '@shared/types/agent';
import type { AgentStatusService } from '../agents/status-service';
import type { HistoryRepo } from '../persistence/history-repo';
import type { PrefsStore } from '../persistence/prefs';
import type { SessionManager } from '../pty/session-manager';
import type { SavedSession } from '../persistence/session-repo';
import type { ProfileRegistry } from '../shell/registry';
import { Router } from './router';
import type { EnvironmentQuery, GitHistoryQuery } from '../env-query/service';
import { enableTuiNotifications, tuiNotificationsEnabled } from '../agents/codex-config';
import { formatRef, resolveWithin, uncToPosix } from '../files/refs';
import { copyMany, moveMany, type TransferResult } from '../files/transfer';
import type { FileWatcher } from '../files/watcher';
import { posix, win32 } from 'node:path';
import type { WslManager } from '../wsl/wsl-manager';
import { mark } from '../timing';
import { logger } from '../logger';
import { gitCommit, gitCreateBranch, gitFetch, gitPull, gitPush, gitStage, gitSwitch, gitUnstage, runGit, type GitResult } from '../git/actions';
import { applyUiScale } from '../window';
import { setAppMenus } from '../app-menu';

export interface Services {
  sessions: SessionManager;
  registry: ProfileRegistry;
  prefs: PrefsStore;
  history: HistoryRepo;
  completion?: { query(req: { requestId: number; sessionId: string; line: string; cursor: number }): Promise<CompletionResponse> };
  agents?: { detect(refresh: boolean): Promise<AgentEntry[]> };
  agentStatus: AgentStatusService;
  savedSessions: () => SavedSession[];
  onPrefsChanged?: (prefs: import('@shared/prefs').Prefs) => void;
  diagnostics: () => Record<string, unknown>;
  envQuery: EnvironmentQuery & GitHistoryQuery;
  wsl: WslManager;
  fileWatcher: FileWatcher;
  getWindow: () => BrowserWindow | undefined;
  origins: () => string[];
}

/** Notifications raised so far; recorded only in end-to-end runs so tests can look at them. */
const notified: Array<{ sessionId: string; title: string; body: string }> = [];

/** Moves PTY output to the renderer over a dedicated MessagePort per session. */
export class PortHub {
  private ports = new Map<string, MessagePortMain>();
  private queue = new Map<string, string[]>();

  constructor(private readonly win: () => BrowserWindow | undefined) {}

  send(id: string, chunk: string): void {
    const port = this.ports.get(id);
    if (port) port.postMessage(chunk);
    else {
      const q = this.queue.get(id) ?? [];
      q.push(chunk);
      this.queue.set(id, q);
    }
  }

  attach(id: string): void {
    this.ports.get(id)?.close();
    const wc = this.win()?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    wc.postMessage('session:port', { id }, [port2]);
    port1.start();
    this.ports.set(id, port1);
    for (const chunk of this.queue.get(id) ?? []) port1.postMessage(chunk);
    this.queue.delete(id);
  }

  detach(id: string): void {
    this.ports.get(id)?.close();
    this.ports.delete(id);
    this.queue.delete(id);
  }
}

export function registerIpc(s: Services, hub: PortHub): void {
  const r = new Router(s.origins);

  r.handle('profiles:list', async (a) => {
    if (a?.waitWsl) await s.registry.whenWslReady();
    return s.registry.refresh(a?.refreshWsl ?? false);
  });

  r.handle('session:create', async (spec) => {
    mark('createRequested');
    const info = await s.sessions.create(spec as SessionSpec);
    hub.attach(info.id);
    s.envQuery.warm?.(info.env);
    return info;
  });
  r.handle('session:close', async ({ id }) => {
    await s.sessions.close(id);
  });
  r.handle('session:rename', ({ id, title }) => s.sessions.rename(id, title));
  r.handle('session:resize', ({ id, cols, rows }) => s.sessions.resize(id, cols, rows));
  r.handle('session:submit', ({ id, command }) => s.sessions.submitCommand(id, command));
  r.handle('session:list', () => {
    const list = s.sessions.list();
    for (const i of list) hub.attach(i.id); // the page may have been reloaded
    return list;
  });
  r.handle('session:saved', () => s.savedSessions());
  r.on('session:write', ({ id, data }) => s.sessions.write(id, data));
  r.on('session:ack', ({ id, length }) => s.sessions.ack(id, length));

  r.handle('prefs:get', () => s.prefs.get());
  r.handle('prefs:set', (patch) => {
    const next = s.prefs.set(patch);
    s.history.setLimit(next.historyLimit);
    if ('uiScale' in patch) {
      const win = s.getWindow();
      if (win) applyUiScale(win, next.uiScale);
    }
    s.onPrefsChanged?.(next);
    return next;
  });

  r.handle('history:search', ({ sessionId, prefix, limit }) => {
    const info = s.sessions.get(sessionId);
    if (!info) return [];
    return s.history.search(envKeyOf(info.env, info.shell), prefix, limit, info.cwd?.path);
  });
  r.handle('history:clear', () => s.history.clear());

  r.handle('completion:query', async (req): Promise<CompletionResponse> => {
    if (!s.completion) return { requestId: req.requestId, items: [] };
    return s.completion.query(req);
  });
  r.handle('agents:detect', (a) => (s.agents ? s.agents.detect(a?.refresh ?? false) : []));

  r.handle('git:changes', async ({ sessionId }) => {
    const info = s.sessions.get(sessionId);
    if (!info?.cwd) return null;
    return (await s.envQuery.gitChanges(info.env, info.cwd.path)) ?? null;
  });

  // The file panel: read-only listing below the tab's working folder, never above it.
  r.handle('fs:list', async ({ sessionId, rel }) => {
    const info = s.sessions.get(sessionId);
    if (!info?.cwd) return { ok: false as const };
    const abs = resolveWithin(info.cwd.path, rel, info.env.kind);
    if (!abs) return { ok: false as const };
    const result = await s.envQuery.listDirResult(info.env, abs);
    if (!result.ok) return result;
    return {
      ok: true as const,
      entries: result.entries
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
        .slice(0, 600)
    };
  });

  // Reading and writing text files below the tab's folder (the file editor). Nothing outside the folder is reachable.
  const target = (sessionId: string, rel: string) => {
    const info = s.sessions.get(sessionId);
    if (!info?.cwd) return undefined;
    const abs = resolveWithin(info.cwd.path, rel, info.env.kind);
    return abs ? { info, root: info.cwd.path, abs } : undefined;
  };
  r.handle('fs:read', async ({ sessionId, rel }) => {
    const t = target(sessionId, rel);
    return t ? s.envQuery.readTextFile(t.info.env, t.root, t.abs) : { ok: false as const, error: 'denied' as const };
  });
  r.handle('fs:readImage', async ({ sessionId, rel }) => {
    const t = target(sessionId, rel);
    return t ? s.envQuery.readImageFile(t.info.env, t.root, t.abs) : { ok: false as const, error: 'denied' as const };
  });
  r.handle('fs:write', async ({ sessionId, rel, text, eol, bom, expectMtimeMs }) => {
    const t = target(sessionId, rel);
    return t
      ? s.envQuery.writeTextFile(t.info.env, t.root, t.abs, text, eol, bom, expectMtimeMs)
      : { ok: false as const, error: 'denied' as const };
  });
  r.handle('fs:stat', async ({ sessionId, rel }) => {
    const t = target(sessionId, rel);
    return t ? s.envQuery.statFile(t.info.env, t.root, t.abs) : null;
  });
  // Creating, renaming and deleting below the tab's folder (the file panel's context menu). The folder itself is never touched.
  r.handle('fs:create', async ({ sessionId, rel, kind }) => {
    const t = target(sessionId, rel);
    return t ? s.envQuery.createEntry(t.info.env, t.root, t.abs, kind) : { ok: false as const, error: 'denied' as const };
  });
  r.handle('fs:rename', async ({ sessionId, from, to }) => {
    const a = target(sessionId, from);
    const b = target(sessionId, to);
    return a && b ? s.envQuery.renameEntry(a.info.env, a.root, a.abs, b.abs) : { ok: false as const, error: 'denied' as const };
  });
  r.handle('fs:delete', async ({ sessionId, rel }) => {
    const t = target(sessionId, rel);
    if (!t) return { ok: false as const, error: 'denied' as const };
    // Windows and macOS have a recycle bin; a WSL folder has none, so there it is removed for good
    return s.envQuery.deleteEntry(t.info.env, t.root, t.abs, t.info.env.kind === 'wsl' ? undefined : (p) => shell.trashItem(p));
  });
  r.handle('fs:reveal', async ({ sessionId, rel }) => {
    const info = s.sessions.get(sessionId);
    if (!info?.cwd) return;
    const abs = rel ? resolveWithin(info.cwd.path, rel, info.env.kind) : info.cwd.path;
    if (!abs) return;
    if (info.env.kind === 'wsl') {
      // the file manager cannot select an item through the WSL share: open the folder (the item's own, or the one holding it)
      const asUnc = (p: string) => `\\\\wsl.localhost\\${info.env.kind === 'wsl' ? info.env.distro : ''}${p.replace(/\//g, '\\')}`;
      const isDir = (await s.envQuery.listDirResult(info.env, abs)).ok;
      const err = await shell.openPath(asUnc(isDir ? abs : posix.dirname(abs)));
      if (err) logger.warn('reveal failed', err);
    } else shell.showItemInFolder(abs);
  });
  // Moving and copying (cut/copy/paste and drag & drop). The answers use paths relative to the tab's folder.
  const transfer = async (
    sessionId: string, from: string[], toDir: string,
    run: typeof moveMany
  ): Promise<{ ok: boolean; results: Array<{ from: string; to?: string; error?: string }> }> => {
    const info = s.sessions.get(sessionId);
    const dest = target(sessionId, toDir || '.');
    const sources = from.map((f) => target(sessionId, f));
    if (!info?.cwd || !dest || sources.some((x) => !x)) return { ok: false, results: [{ from: from[0] ?? '', error: 'denied' }] };
    const lib = info.env.kind === 'windows' ? win32 : posix;
    const root = info.cwd.path;
    // the folder itself is a valid destination; resolveWithin of '.' gives it
    const results: TransferResult[] = await run(s.envQuery, info.env, root, sources.map((x) => x!.abs), dest.abs);
    return {
      ok: results.every((x) => !x.error),
      results: results.map((x) => ({
        from: lib.relative(root, x.from),
        ...(x.to ? { to: lib.relative(root, x.to) } : {}),
        ...(x.error ? { error: x.error } : {})
      }))
    };
  };
  r.handle('fs:move', ({ sessionId, from, toDir }) => transfer(sessionId, from, toDir, moveMany));
  r.handle('fs:copy', ({ sessionId, from, toDir }) => transfer(sessionId, from, toDir, copyMany));
  // The folders the panel shows open; changes in them come back as 'fs:changed'. `polling` = the panel has to look itself.
  r.handle('fs:watch', ({ sessionId, dirs }) => {
    const info = s.sessions.get(sessionId);
    if (!info?.cwd) return { polling: true };
    return { polling: !s.fileWatcher.setDirs(sessionId, info.env, info.cwd.path, dirs) };
  });
  r.handle('git:status', async ({ sessionId }) => {
    const info = s.sessions.get(sessionId);
    return info?.cwd ? ((await s.envQuery.gitStatusAll(info.env, info.cwd.path)) ?? null) : null;
  });

  // Choose files to attach to a message; answers with ready-to-insert "@path" references.
  r.handle('app:pickFiles', async ({ sessionId }) => {
    const info = s.sessions.get(sessionId);
    if (!info?.cwd) return [];
    const win = s.getWindow();
    const forced = process.env['ARCTRI_E2E_PICK']; // tests answer the dialog through this variable
    let picked: string[];
    if (forced) picked = JSON.parse(forced) as string[];
    else {
      const start =
        info.env.kind === 'wsl'
          ? `\\\\wsl.localhost\\${info.env.distro}${info.cwd.path.replace(/\//g, '\\')}`
          : info.cwd.path;
      const r = await dialog.showOpenDialog(win!, { defaultPath: start, properties: ['openFile', 'multiSelections'] });
      picked = r.canceled ? [] : r.filePaths;
    }
    const refs: string[] = [];
    for (const f of picked) {
      if (info.env.kind === 'windows') refs.push(formatRef(info.cwd.path, f, 'windows'));
      else if (info.env.kind === 'local') refs.push(formatRef(info.cwd.path, f, 'local'));
      else {
        const posixPath = uncToPosix(f, info.env.distro) ?? (f.startsWith('/') ? f : await s.wsl.toPosix(info.env.distro, f));
        if (posixPath) refs.push(formatRef(info.cwd.path, posixPath, 'wsl'));
      }
    }
    return refs;
  });

  // Choose a project folder. Answers with the folder as the environment it lives in (a \\wsl.localhost path is a WSL folder).
  r.handle('app:pickFolder', async () => {
    const forced = process.env['ARCTRI_E2E_PICK'];
    let dir: string | undefined;
    if (forced) dir = (JSON.parse(forced) as string[])[0];
    else {
      const win = s.getWindow();
      const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
      dir = r.canceled ? undefined : r.filePaths[0];
    }
    if (!dir) return null;
    const m = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i.exec(dir);
    if (m) return { env: 'wsl' as const, distro: m[1]!, path: (m[2] ?? '\\').replace(/\\/g, '/') };
    if (process.platform !== 'win32') return { env: 'local' as const, path: dir };
    return { env: 'windows' as const, path: dir };
  });

  const repo = (sessionId: string) => {
    const info = s.sessions.get(sessionId);
    return info?.cwd ? { info, cwd: info.cwd.path } : undefined;
  };
  // Git actions that write (stage, commit, branch, push). Paths are checked to stay below the tab's folder.
  const afterGit = (sessionId: string, res: GitResult): GitResult => {
    const target = repo(sessionId);
    for (const tab of s.sessions.list()) {
      if (target && tab.cwd?.path === target.cwd && tab.env.kind === target.info.env.kind &&
          (tab.env.kind !== 'wsl' || (target.info.env.kind === 'wsl' && tab.env.distro === target.info.env.distro))) {
        s.sessions.refreshBranch(tab.id);
      }
    }
    return res;
  };
  const NO_TAB: GitResult = { ok: false, error: 'no folder' };
  const branchPreflight = async (sessionId: string) => {
    const t = repo(sessionId);
    if (!t) return { ok: false, dirty: false, error: 'no folder' };
    const status = await runGit(t.info.env, t.cwd, ['status', '--porcelain', '--untracked-files=normal']);
    if (status.code !== 0) return { ok: false, dirty: false, error: status.stderr || 'git status failed' };
    return { ok: true, dirty: !!status.stdout.trim() };
  };
  r.handle('git:branchPreflight', ({ sessionId }) => branchPreflight(sessionId));
  r.handle('git:stage', async ({ sessionId, paths }) => {
    const t = repo(sessionId);
    return t ? afterGit(sessionId, await gitStage(t.info.env, t.cwd, paths)) : NO_TAB;
  });
  r.handle('git:unstage', async ({ sessionId, paths }) => {
    const t = repo(sessionId);
    return t ? afterGit(sessionId, await gitUnstage(t.info.env, t.cwd, paths)) : NO_TAB;
  });
  r.handle('git:commit', async ({ sessionId, message }) => {
    const t = repo(sessionId);
    return t ? afterGit(sessionId, await gitCommit(t.info.env, t.cwd, message)) : NO_TAB;
  });
  r.handle('git:createBranch', async ({ sessionId, name }) => {
    const t = repo(sessionId);
    if (!t) return NO_TAB;
    const gate = await branchPreflight(sessionId);
    if (!gate.ok) return { ok: false as const, error: gate.error ?? 'git failed' };
    return afterGit(sessionId, await gitCreateBranch(t.info.env, t.cwd, name));
  });
  r.handle('git:push', async ({ sessionId }) => {
    const t = repo(sessionId);
    return t ? afterGit(sessionId, await gitPush(t.info.env, t.cwd)) : NO_TAB;
  });
  r.handle('git:fetch', async ({ sessionId }) => {
    const t = repo(sessionId);
    return t ? afterGit(sessionId, await gitFetch(t.info.env, t.cwd)) : NO_TAB;
  });
  r.handle('git:pull', async ({ sessionId }) => {
    const t = repo(sessionId);
    return t ? afterGit(sessionId, await gitPull(t.info.env, t.cwd)) : NO_TAB;
  });
  r.handle('git:switch', async ({ sessionId, name, remote }) => {
    const t = repo(sessionId);
    if (!t) return NO_TAB;
    const gate = await branchPreflight(sessionId);
    if (!gate.ok) return { ok: false as const, error: gate.error ?? 'git failed' };
    return afterGit(sessionId, await gitSwitch(t.info.env, t.cwd, name, remote));
  });

  r.handle('git:refs', async ({ sessionId }) => {
    const t = repo(sessionId);
    return t ? ((await s.envQuery.gitRefs(t.info.env, t.cwd)) ?? null) : null;
  });
  r.handle('git:log', async ({ sessionId, limit }) => {
    const t = repo(sessionId);
    return t ? ((await s.envQuery.gitLog(t.info.env, t.cwd, limit)) ?? null) : null;
  });
  r.handle('git:commitFiles', async ({ sessionId, hash }) => {
    const t = repo(sessionId);
    return t ? ((await s.envQuery.gitCommitFiles(t.info.env, t.cwd, hash)) ?? null) : null;
  });
  r.handle('git:revText', async ({ sessionId, rel, rev }) => {
    const t = target(sessionId, rel);
    return t ? ((await s.envQuery.gitRevText(t.info.env, t.root, rel, rev)) ?? null) : null;
  });
  r.handle('git:headText', async ({ sessionId, rel }) => {
    const t = target(sessionId, rel);
    return t ? ((await s.envQuery.gitHeadText(t.info.env, t.root, rel)) ?? null) : null;
  });

  r.handle('agents:codexNotifications', async ({ sessionId, action }) => {
    const info = s.sessions.get(sessionId);
    if (!info) return { enabled: false, available: false };
    const text = await s.envQuery.readCodexConfig(info.env);
    if (text === undefined) return { enabled: false, available: false };
    const enabled = text !== null && tuiNotificationsEnabled(text);
    if (action === 'status' || enabled) return { enabled, available: true };
    const ok = await s.envQuery.writeCodexConfig(info.env, enableTuiNotifications(text ?? ''));
    return { enabled: ok, available: true, changed: ok };
  });

  r.handle('agentStatus:list', () => s.agentStatus.list());
  r.handle('agentStatus:markRead', ({ sessionId }) => s.agentStatus.markRead(sessionId));
  r.handle('agentStatus:active', ({ sessionId }) => s.agentStatus.setActive(sessionId));
  r.handle('agentStatus:input', ({ sessionId, kind }) => s.agentStatus.userInput(sessionId, kind));
  r.handle('agentStatus:signal', ({ sessionId }) => {
    const info = s.sessions.get(sessionId);
    const agentId = info?.kind === 'agent' ? info.agentId : info?.runningAgent?.agentId;
    // only a tab that runs an agent may raise a signal; anything else is ordinary terminal output
    if (agentId) s.agentStatus.terminalSignal(sessionId, agentId);
  });

  r.handle('app:notify', ({ sessionId, title, body }) => {
    if (process.env['ARCTRI_E2E']) notified.push({ sessionId, title, body });
    if (!s.prefs.get().agentNotifications || !Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => {
      const win = s.getWindow();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('app:focus-session', sessionId);
    });
    n.show();
  });

  r.handle('app:diagnostics', () => (process.env['ARCTRI_E2E'] ? { ...s.diagnostics(), notifications: notified } : s.diagnostics()));
  r.handle('app:openExternal', ({ url }) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
    return undefined;
  });
  r.handle('app:openPath', ({ sessionId }) => {
    const cwd = s.sessions.get(sessionId)?.cwd;
    if (cwd?.env === 'windows' || cwd?.env === 'local') return shell.openPath(cwd.path);
    if (cwd?.env === 'wsl') return shell.openPath(`\\\\wsl.localhost\\${cwd.distro}${cwd.path.replace(/\//g, '\\')}`);
    return undefined;
  });
  r.handle('app:setMenu', ({ menus }) => setAppMenus(menus, (id) => s.getWindow()?.webContents.send('app:menu', { id })));
}

export function sendInfo(win: BrowserWindow | undefined, info: SessionInfo): void {
  if (win && !win.isDestroyed()) win.webContents.send('session:changed', info);
}

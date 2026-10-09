import { dialog, Notification, shell, MessageChannelMain, type BrowserWindow, type MessagePortMain } from 'electron';
import type { SessionInfo, SessionSpec } from '@shared/types/session';
import { envKeyOf } from '@shared/types/env';
import type { CompletionResponse } from '@shared/types/completion';
import type { AgentEntry } from '@shared/types/agent';
import type { HistoryRepo } from '../persistence/history-repo';
import type { PrefsStore } from '../persistence/prefs';
import type { SessionManager } from '../pty/session-manager';
import type { SavedSession } from '../persistence/session-repo';
import type { ProfileRegistry } from '../shell/registry';
import { Router } from './router';
import type { EnvironmentQuery } from '../env-query/service';
import { enableTuiNotifications, tuiNotificationsEnabled } from '../agents/codex-config';
import { formatRef, resolveWithin, uncToPosix } from '../files/refs';
import type { WslManager } from '../wsl/wsl-manager';
import { mark } from '../timing';
import { applyUiScale } from '../window';

export interface Services {
  sessions: SessionManager;
  registry: ProfileRegistry;
  prefs: PrefsStore;
  history: HistoryRepo;
  completion?: { query(req: { requestId: number; sessionId: string; line: string; cursor: number }): Promise<CompletionResponse> };
  agents?: { detect(refresh: boolean): Promise<AgentEntry[]> };
  savedSessions: () => SavedSession[];
  onPrefsChanged?: (prefs: import('@shared/prefs').Prefs) => void;
  diagnostics: () => Record<string, unknown>;
  envQuery: EnvironmentQuery;
  wsl: WslManager;
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
    return { env: 'windows' as const, path: dir };
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
    if (cwd?.env === 'windows') return shell.openPath(cwd.path);
    if (cwd?.env === 'wsl') return shell.openPath(`\\\\wsl.localhost\\${cwd.distro}${cwd.path.replace(/\//g, '\\')}`);
    return undefined;
  });
}

export function sendInfo(win: BrowserWindow | undefined, info: SessionInfo): void {
  if (win && !win.isDestroyed()) win.webContents.send('session:changed', info);
}

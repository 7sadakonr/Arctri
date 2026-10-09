import { app, shell, MessageChannelMain, type BrowserWindow, type MessagePortMain } from 'electron';
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
import { mark } from '../timing';

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
  getWindow: () => BrowserWindow | undefined;
  origins: () => string[];
}

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

  r.handle('app:diagnostics', () => s.diagnostics());
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
  void app;
}

export function sendInfo(win: BrowserWindow | undefined, info: SessionInfo): void {
  if (win && !win.isDestroyed()) win.webContents.send('session:changed', info);
}

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Prefs } from '@shared/prefs';
import type { SessionId, SessionInfo, SessionSpec } from '@shared/types/session';
import type { CompletionResponse } from '@shared/types/completion';
import type { AgentEntry } from '@shared/types/agent';
import type { ProfilesResult } from '../main/shell/registry';

type GitActionResult = { ok: true; out: string } | { ok: false; error: string };
type Unsub = () => void;
type DataHandler = (chunk: string) => void;

// PTY output arrives on one MessagePort per session; chunks that arrive before the
// renderer subscribes are held until it does.
const ports = new Map<SessionId, MessagePort>();
const handlers = new Map<SessionId, DataHandler>();
const backlog = new Map<SessionId, string[]>();

ipcRenderer.on('session:port', (event: IpcRendererEvent, msg: { id: SessionId }) => {
  const port = event.ports[0];
  if (!port) return;
  ports.get(msg.id)?.close();
  ports.set(msg.id, port);
  port.onmessage = (e) => {
    const h = handlers.get(msg.id);
    if (h) h(e.data as string);
    else {
      const held = backlog.get(msg.id);
      if (held) held.push(e.data as string);
      else backlog.set(msg.id, [e.data as string]);
    }
  };
});

function subscribe<T>(channel: string, cb: (v: T) => void): Unsub {
  const listener = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  platform: process.platform,
  profiles: {
    list: (refreshWsl = false, waitWsl = false): Promise<ProfilesResult> =>
      ipcRenderer.invoke('profiles:list', { refreshWsl, waitWsl })
  },
  sessions: {
    create: (spec: SessionSpec): Promise<SessionInfo> => ipcRenderer.invoke('session:create', spec),
    close: (id: SessionId): Promise<void> => ipcRenderer.invoke('session:close', { id }),
    rename: (id: SessionId, title: string): Promise<void> => ipcRenderer.invoke('session:rename', { id, title }),
    resize: (id: SessionId, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('session:resize', { id, cols, rows }),
    submit: (id: SessionId, command: string): Promise<{ ok: true } | { ok: false; reason: string }> =>
      ipcRenderer.invoke('session:submit', { id, command }),
    list: (): Promise<SessionInfo[]> => ipcRenderer.invoke('session:list'),
    saved: (): Promise<
      Array<{ id: string; title: string; titleSource: 'user' | 'auto'; profileId: string; kind: 'shell' | 'agent'; cwd?: import('@shared/types/env').EnvPath }>
    > => ipcRenderer.invoke('session:saved'),
    write: (id: SessionId, data: string): void => ipcRenderer.send('session:write', { id, data }),
    ack: (id: SessionId, length: number): void => ipcRenderer.send('session:ack', { id, length }),
    onData: (id: SessionId, cb: DataHandler): Unsub => {
      handlers.set(id, cb);
      const pending = backlog.get(id);
      if (pending) {
        backlog.delete(id);
        for (const c of pending) cb(c);
      }
      return () => {
        if (handlers.get(id) === cb) handlers.delete(id);
      };
    },
    onChanged: (cb: (i: SessionInfo) => void): Unsub => subscribe('session:changed', cb),
    onClosed: (cb: (id: SessionId) => void): Unsub => subscribe('session:closed', cb),
    onFocusRequested: (cb: (id: SessionId) => void): Unsub => subscribe('app:focus-session', cb)
  },
  prefs: {
    get: (): Promise<Prefs> => ipcRenderer.invoke('prefs:get'),
    set: (patch: Partial<Prefs>): Promise<Prefs> => ipcRenderer.invoke('prefs:set', patch)
  },
  history: {
    search: (sessionId: SessionId, prefix: string, limit: number) =>
      ipcRenderer.invoke('history:search', { sessionId, prefix, limit }) as Promise<
        Array<{ command: string; lastAt: number; count: number }>
      >,
    clear: (): Promise<void> => ipcRenderer.invoke('history:clear')
  },
  completion: {
    query: (req: { requestId: number; sessionId: SessionId; line: string; cursor: number }): Promise<CompletionResponse> =>
      ipcRenderer.invoke('completion:query', req)
  },
  agents: {
    detect: (refresh = false): Promise<AgentEntry[]> => ipcRenderer.invoke('agents:detect', { refresh }),
    codexNotifications: (sessionId: SessionId, action: 'status' | 'enable'): Promise<{ enabled: boolean; available: boolean; changed?: boolean }> =>
      ipcRenderer.invoke('agents:codexNotifications', { sessionId, action })
  },
  files: {
    changes: (sessionId: SessionId): Promise<{
      files: Array<{ path: string; status: string; added: number; deleted: number }>; added: number; deleted: number
    } | null> => ipcRenderer.invoke('git:changes', { sessionId }),
    list: (sessionId: SessionId, rel: string): Promise<{ ok: true; entries: Array<{ name: string; isDir: boolean }> } | { ok: false }> =>
      ipcRenderer.invoke('fs:list', { sessionId, rel }),
    pick: (sessionId: SessionId): Promise<string[]> => ipcRenderer.invoke('app:pickFiles', { sessionId }),
    headText: (sessionId: SessionId, rel: string): Promise<string | null> => ipcRenderer.invoke('git:headText', { sessionId, rel }),
    stage: (sessionId: SessionId, paths: string[] | 'all'): Promise<GitActionResult> => ipcRenderer.invoke('git:stage', { sessionId, paths }),
    unstage: (sessionId: SessionId, paths: string[] | 'all'): Promise<GitActionResult> => ipcRenderer.invoke('git:unstage', { sessionId, paths }),
    commit: (sessionId: SessionId, message: string): Promise<GitActionResult> => ipcRenderer.invoke('git:commit', { sessionId, message }),
    createBranch: (sessionId: SessionId, name: string): Promise<GitActionResult> => ipcRenderer.invoke('git:createBranch', { sessionId, name }),
    branchPreflight: (sessionId: SessionId): Promise<{ ok: boolean; dirty: boolean; runningAgent: boolean; error?: string }> =>
      ipcRenderer.invoke('git:branchPreflight', { sessionId }),
    push: (sessionId: SessionId): Promise<GitActionResult> => ipcRenderer.invoke('git:push', { sessionId }),
    fetch: (sessionId: SessionId): Promise<GitActionResult> => ipcRenderer.invoke('git:fetch', { sessionId }),
    pull: (sessionId: SessionId): Promise<GitActionResult> => ipcRenderer.invoke('git:pull', { sessionId }),
    switchBranch: (sessionId: SessionId, name: string, remote: boolean): Promise<GitActionResult> =>
      ipcRenderer.invoke('git:switch', { sessionId, name, remote }),
    refs: (sessionId: SessionId): Promise<{
      current?: string;
      local: Array<{ name: string; upstream?: string; ahead?: number; behind?: number }>;
      remote: Array<{ name: string; upstream?: string; ahead?: number; behind?: number }>;
    } | null> => ipcRenderer.invoke('git:refs', { sessionId }),
    log: (sessionId: SessionId, limit = 100): Promise<Array<{
      hash: string; short: string; author: string; time: number; refs: string[]; subject: string;
    }> | null> => ipcRenderer.invoke('git:log', { sessionId, limit }),
    commitFiles: (sessionId: SessionId, hash: string): Promise<Array<{
      path: string; status: string; added: number; deleted: number;
    }> | null> => ipcRenderer.invoke('git:commitFiles', { sessionId, hash }),
    revText: (sessionId: SessionId, rel: string, rev: string): Promise<string | null> =>
      ipcRenderer.invoke('git:revText', { sessionId, rel, rev }),
    status: (sessionId: SessionId): Promise<Array<{ path: string; status: string }> | null> =>
      ipcRenderer.invoke('git:status', { sessionId }),
    read: (sessionId: SessionId, rel: string): Promise<
      | { ok: true; text: string; eol: 'lf' | 'crlf'; bom: boolean; mtimeMs: number; size: number }
      | { ok: false; error: 'too-large' | 'binary' | 'not-found' | 'denied' | 'failed' }
    > => ipcRenderer.invoke('fs:read', { sessionId, rel }),
    readImage: (sessionId: SessionId, rel: string): Promise<
      | { ok: true; base64: string; mtimeMs: number; size: number }
      | { ok: false; error: 'too-large' | 'binary' | 'not-found' | 'denied' | 'failed' }
    > => ipcRenderer.invoke('fs:readImage', { sessionId, rel }),
    write: (
      sessionId: SessionId, rel: string, text: string, eol: 'lf' | 'crlf', bom: boolean, expectMtimeMs?: number
    ): Promise<{ ok: true; mtimeMs: number } | { ok: false; error: 'conflict' | 'denied' | 'failed'; mtimeMs?: number }> =>
      ipcRenderer.invoke('fs:write', { sessionId, rel, text, eol, bom, ...(expectMtimeMs !== undefined ? { expectMtimeMs } : {}) }),
    stat: (sessionId: SessionId, rel: string): Promise<{ mtimeMs: number; size: number } | null> =>
      ipcRenderer.invoke('fs:stat', { sessionId, rel })
  },
  app: {
    diagnostics: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('app:diagnostics'),
    pickFolder: (): Promise<{ env: 'windows'; path: string } | { env: 'wsl'; distro: string; path: string } | null> =>
      ipcRenderer.invoke('app:pickFolder'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', { url }),
    openPath: (sessionId: SessionId): Promise<void> => ipcRenderer.invoke('app:openPath', { sessionId }),
    notify: (sessionId: SessionId, title: string, body: string): Promise<void> =>
      ipcRenderer.invoke('app:notify', { sessionId, title, body })
  }
};

export type ArctriApi = typeof api;
contextBridge.exposeInMainWorld('arctri', api);

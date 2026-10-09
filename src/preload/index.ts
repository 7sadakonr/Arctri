import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Prefs } from '@shared/prefs';
import type { SessionId, SessionInfo, SessionSpec } from '@shared/types/session';
import type { CompletionResponse } from '@shared/types/completion';
import type { AgentEntry } from '@shared/types/agent';
import type { ProfilesResult } from '../main/shell/registry';

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
    else backlog.set(msg.id, [...(backlog.get(msg.id) ?? []), e.data as string]);
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
    onClosed: (cb: (id: SessionId) => void): Unsub => subscribe('session:closed', cb)
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
    detect: (refresh = false): Promise<AgentEntry[]> => ipcRenderer.invoke('agents:detect', { refresh })
  },
  app: {
    diagnostics: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('app:diagnostics'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', { url }),
    openPath: (sessionId: SessionId): Promise<void> => ipcRenderer.invoke('app:openPath', { sessionId })
  }
};

export type AgentDockApi = typeof api;
contextBridge.exposeInMainWorld('agentdock', api);

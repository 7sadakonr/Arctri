import { create } from 'zustand';
import type { PreWorkCheck, RepoSyncSnapshot } from '@shared/git/sync';
import type { EnvPath } from '@shared/types/env';
import { api } from '@/lib/api';
import { tNow } from '@/lib/i18n';
import { useUi } from '@/stores/ui';

export interface PreWorkRequest {
  snap: RepoSyncSnapshot;
  dirtyFiles: string[];
  resolve: (go: boolean) => void;
}

interface PreWorkState {
  request?: PreWorkRequest;
  ask(snap: RepoSyncSnapshot, dirtyFiles: string[]): Promise<boolean>;
  close(go: boolean): void;
}

export const usePreWork = create<PreWorkState>()((set, get) => ({
  ask: (snap, dirtyFiles) =>
    new Promise<boolean>((resolve) => {
      get().request?.resolve(false);
      set({ request: { snap, dirtyFiles, resolve } });
    }),
  close: (go) => {
    get().request?.resolve(go);
    set({ request: undefined });
  }
}));

/** Whether anything is worth telling the user before an agent starts changing files. Offline alone is not. */
export function needsAttention(c: PreWorkCheck): boolean {
  const s = c.snapshot;
  return !!s && (s.status === 'behind' || s.status === 'diverged' || s.dirtyOnDisk || s.unsavedInArctri.length > 0);
}

const TIMEOUT = Symbol('timeout');

/**
 * Looks at the repository before the app starts an agent in `cwd` and lets the user decide. Never blocks for long and
 * never changes anything by itself: a check that fails or takes too long lets the agent start.
 */
export async function confirmPreWork(cwd: EnvPath): Promise<boolean> {
  let check: PreWorkCheck | typeof TIMEOUT;
  try {
    check = await Promise.race([api.gitSync.preWorkCheck(cwd), new Promise<typeof TIMEOUT>((r) => setTimeout(() => r(TIMEOUT), 4000))]);
  } catch {
    return true;
  }
  if (check === TIMEOUT || !check.snapshot || !needsAttention(check)) return true;
  return usePreWork.getState().ask(check.snapshot, check.dirtyFiles);
}

/** An agent was typed into a shell: nothing is intercepted, but the user hears if it works on old files. */
export async function warnAgentStarted(sessionId: string): Promise<void> {
  const s = await api.gitSync.status(sessionId).catch(() => null);
  if (!s?.upstream) return;
  const params = { branch: s.branch ?? 'HEAD', upstream: s.upstream, n: s.behind ?? 0 };
  if (s.status === 'behind') useUi.getState().toast(tNow('sync.passiveBehind', params));
  else if (s.status === 'diverged') useUi.getState().toast(tNow('sync.passiveDiverged', params));
}

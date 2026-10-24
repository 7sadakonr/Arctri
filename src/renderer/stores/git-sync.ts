import { useEffect } from 'react';
import { create } from 'zustand';
import type { GitSyncResult, RepoSyncSnapshot } from '@shared/git/sync';
import { api } from '@/lib/api';

interface GitSyncState {
  bySession: Record<string, RepoSyncSnapshot | undefined>;
  /** Bumped when the repository moved on (a switch, a commit, a pull, maybe from another program): views reload on it. */
  epoch: Record<string, number>;
  /** Bumped only when the repository moved on outside Arctri's own actions (a branch switch or new commits from elsewhere). */
  external: Record<string, number>;
  set(sessionIds: string[], snapshot: RepoSyncSnapshot): void;
  bump(sessionIds: string[], external: boolean): void;
  forget(sessionId: string): void;
}

export const useGitSyncStore = create<GitSyncState>()((set) => ({
  bySession: {},
  epoch: {},
  external: {},
  set: (ids, snapshot) => set((s) => ({ bySession: { ...s.bySession, ...Object.fromEntries(ids.map((id) => [id, snapshot])) } })),
  bump: (ids, external) =>
    set((s) => ({
      epoch: { ...s.epoch, ...Object.fromEntries(ids.map((id) => [id, (s.epoch[id] ?? 0) + 1])) },
      ...(external ? { external: { ...s.external, ...Object.fromEntries(ids.map((id) => [id, (s.external[id] ?? 0) + 1])) } } : {})
    })),
  forget: (id) =>
    set((s) => {
      const { [id]: _a, ...bySession } = s.bySession;
      const { [id]: _b, ...epoch } = s.epoch;
      const { [id]: _c, ...external } = s.external;
      return { bySession, epoch, external };
    })
}));

const asked = new Set<string>();

/** The tab's repository standing, shared with every tab in the same worktree; read once on first use, then pushed. */
export function useGitSync(sessionId: string): RepoSyncSnapshot | undefined {
  const snap = useGitSyncStore((s) => s.bySession[sessionId]);
  useEffect(() => {
    if (snap || asked.has(sessionId)) return;
    asked.add(sessionId);
    void api.gitSync.status(sessionId).then(
      (r) => {
        asked.delete(sessionId);
        if (r) useGitSyncStore.getState().set([sessionId], r);
      },
      () => asked.delete(sessionId)
    );
  }, [sessionId, snap]);
  return snap;
}

/** Changes whenever the repository moved on; put it in the dependencies of whatever loads git data. */
export const useGitExternalEpoch = (sessionId: string): number => useGitSyncStore((s) => s.external[sessionId] ?? 0);

export const useGitEpoch = (sessionId: string): number => useGitSyncStore((s) => s.epoch[sessionId] ?? 0);

export type SyncFailure = Extract<GitSyncResult, { ok: false }>;

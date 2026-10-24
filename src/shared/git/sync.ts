export type GitSyncStatus =
  | 'fetching'
  | 'up-to-date'
  | 'behind'
  | 'ahead'
  | 'diverged'
  | 'no-upstream'
  | 'detached'
  | 'offline'
  | 'unknown';

export type GitSyncErrorCode =
  | 'NO_UPSTREAM'
  | 'DETACHED'
  | 'DIRTY_WORKTREE'
  | 'CONFLICTS'
  | 'UNSAVED_EDITOR'
  | 'DIVERGED'
  | 'OFFLINE'
  | 'AUTH_REQUIRED'
  | 'GIT_BUSY'
  | 'AGENT_ACTIVE'
  | 'BRANCH_CHANGED'
  | 'FAILED';

export interface RepoSyncSnapshot {
  /** The worktree's identity (environment + top-level folder), shared by every tab that works in it. */
  repoId: string;
  repoRoot: string;
  branch?: string;
  headSha?: string;
  upstream?: string;
  ahead: number | null;
  behind: number | null;
  status: GitSyncStatus;
  dirtyOnDisk: boolean;
  /** Paths (relative to the tab's folder) with unsaved edits in Arctri's editor. */
  unsavedInArctri: string[];
  activeAgent: boolean;
  /** An agent runs here but reports no status, so it may be editing files. A warning only. */
  agentUnknown: boolean;
  /** An operation (merge, rebase, cherry-pick, a lock file) is under way. */
  busy: boolean;
  conflicts: boolean;
  /** Last successful fetch (ms since the epoch). */
  fetchedAt?: number;
  /** When the comparison above was made. */
  checkedAt: number;
  remoteError?: { code: 'OFFLINE' | 'AUTH_REQUIRED'; message: string };
}

export type GitSyncResult<T = undefined> =
  | ({ ok: true; message?: string } & (T extends undefined ? unknown : { value: T }))
  | { ok: false; code: GitSyncErrorCode; error: string };

export interface PreWorkCheck {
  snapshot: RepoSyncSnapshot | null;
  /** Up to 10 changed paths, for the dialog. */
  dirtyFiles: string[];
}

export interface RepoChanged {
  sessionIds: string[];
  reason: 'head' | 'branch' | 'refs' | 'update';
}

export interface SyncInputs {
  detached: boolean;
  upstream?: string | undefined;
  ahead: number | null;
  behind: number | null;
  fetching?: boolean;
  remoteError?: boolean;
  /** Never successfully compared (git could not answer). */
  unknown?: boolean;
}

/**
 * The branch's standing against its upstream. A failed remote check never reads as "up to date": the numbers shown are
 * those of the last successful comparison and the status says the remote could not be reached.
 */
export function classifySync(i: SyncInputs): GitSyncStatus {
  if (i.fetching) return 'fetching';
  if (i.unknown) return 'unknown';
  if (i.detached) return 'detached';
  if (!i.upstream) return 'no-upstream';
  if (i.remoteError) return 'offline';
  if (i.ahead === null || i.behind === null) return 'unknown';
  if (i.ahead > 0 && i.behind > 0) return 'diverged';
  if (i.behind > 0) return 'behind';
  if (i.ahead > 0) return 'ahead';
  return 'up-to-date';
}

/** Tells a refused login from a server that cannot be reached, from git's words. */
export function classifyRemoteError(text: string): 'OFFLINE' | 'AUTH_REQUIRED' {
  return /authentication failed|could not read (username|password)|permission denied \(publickey|terminal prompts disabled|invalid credentials|requested url returned error: 40[13]|repository not found/i.test(text)
    ? 'AUTH_REQUIRED'
    : 'OFFLINE';
}

/** `git status --porcelain` entries that mean an unresolved merge. */
export function hasConflict(porcelain: string): boolean {
  return porcelain.split(/\r?\n/).some((l) => /^(DD|AU|UD|UA|DU|AA|UU)\s/.test(l));
}

/** Paths from `git status --porcelain` (renames give the new name). */
export function porcelainPaths(porcelain: string): string[] {
  const out: string[] = [];
  for (const l of porcelain.split(/\r?\n/)) {
    if (l.length < 4) continue;
    const p = l.slice(3);
    const arrow = p.indexOf(' -> ');
    out.push(arrow >= 0 ? p.slice(arrow + 4) : p);
  }
  return out;
}

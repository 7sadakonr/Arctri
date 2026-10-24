import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EnvironmentRef } from '@shared/types/env';
import {
  classifyRemoteError, classifySync, hasConflict, porcelainPaths,
  type GitSyncErrorCode, type GitSyncResult, type PreWorkCheck, type RepoChanged, type RepoSyncSnapshot
} from '@shared/git/sync';
import { errorText, gitFetch, runGit } from './actions';
import { fsPathOf, resolveRepo, type RepoIdentity } from './repo-identity';
import { GitRepoWatcher, repoFingerprint } from './repo-watcher';

export type AgentActivity = 'active' | 'unknown' | 'idle';

export interface SyncDeps {
  /** The tab's environment and folder; undefined once the tab is gone. */
  session(id: string): { env: EnvironmentRef; cwd: string } | undefined;
  /** Whether an agent in that tab may be changing files right now. */
  agentActivity(sessionId: string): AgentActivity;
  emit(channel: 'git:syncChanged' | 'git:repoChanged', payload: unknown): void;
  /** Reads the branch of the tab again (the label on the tab). */
  refreshBranch(sessionId: string): void;
  autoFetch(): boolean;
  now?: () => number;
  /** Watch git's metadata for changes made outside Arctri (default true). */
  watch?: boolean;
  /** A reading of the repository for a folder inside a WSL distribution, without starting git through wsl.exe each time. */
  signature?: (env: EnvironmentRef, cwd: string) => Promise<string | null>;
}

interface Repo {
  id: RepoIdentity;
  env: EnvironmentRef;
  /** A folder git can run in (the first tab's). */
  cwd: string;
  sessions: Set<string>;
  unsaved: Map<string, string[]>;
  snapshot?: RepoSyncSnapshot;
  fetching?: Promise<GitSyncResult>;
  fetchedAt?: number;
  remoteError?: RepoSyncSnapshot['remoteError'];
  tail: Promise<unknown>;
  fetchTimer?: ReturnType<typeof setTimeout>;
  activityTimer?: ReturnType<typeof setTimeout>;
  interval?: ReturnType<typeof setInterval>;
  watcher?: GitRepoWatcher;
}

/** A queued git action that has not finished by now stops holding up the ones behind it. */
const QUEUE_LIMIT_MS = 10 * 60_000;
const FETCH_GAP_MS = 60_000;
const FETCH_EVERY_MS = 5 * 60_000;
const FETCH_DELAY_MS = 2000;
const TIMEOUT = Symbol('timeout');

const sameSnapshot = (a: RepoSyncSnapshot | undefined, b: RepoSyncSnapshot): boolean =>
  !!a && JSON.stringify({ ...a, checkedAt: 0 }) === JSON.stringify({ ...b, checkedAt: 0 });

/**
 * What Arctri knows about each repository, once per worktree however many tabs work in it: where it stands against
 * its upstream, when it was last asked, and the one queue every git action that writes goes through.
 */
export class GitSyncService {
  private repos = new Map<string, Repo>();
  private byCwd = new Map<string, Promise<RepoIdentity | undefined>>();
  private bySession = new Map<string, string>();
  private focused = true;
  private blurredAt = 0;

  constructor(private readonly deps: SyncDeps) {}

  private now = (): number => this.deps.now?.() ?? Date.now();

  // ---- tabs -------------------------------------------------------------------------------------------------------

  /** Connects a tab to its repository (call again when the tab's folder changes). Resolves to the repository's id. */
  async attach(sessionId: string): Promise<string | undefined> {
    const s = this.deps.session(sessionId);
    if (!s) return undefined;
    const key = `${s.env.kind === 'wsl' ? s.env.distro : s.env.kind}|${s.cwd}`;
    let pending = this.byCwd.get(key);
    if (!pending) {
      pending = resolveRepo(s.env, s.cwd);
      this.byCwd.set(key, pending);
      void pending.then((r) => !r && this.byCwd.delete(key));
    }
    const identity = await pending;
    const previous = this.bySession.get(sessionId);
    if (!identity) {
      this.detach(sessionId);
      return undefined;
    }
    if (previous && previous !== identity.repoId) this.detach(sessionId);
    let repo = this.repos.get(identity.repoId);
    if (!repo) {
      repo = { id: identity, env: s.env, cwd: s.cwd, sessions: new Set(), unsaved: new Map(), tail: Promise.resolve() };
      this.repos.set(identity.repoId, repo);
      this.start(repo);
    }
    repo.sessions.add(sessionId);
    this.bySession.set(sessionId, identity.repoId);
    if (this.deps.autoFetch()) this.scheduleFetch(identity.repoId, 'open', 1500);
    return identity.repoId;
  }

  detach(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    this.bySession.delete(sessionId);
    const repo = id ? this.repos.get(id) : undefined;
    if (!repo) return;
    repo.sessions.delete(sessionId);
    repo.unsaved.delete(sessionId);
    if (repo.sessions.size) return;
    this.stop(repo);
    this.repos.delete(repo.id.repoId);
  }

  repoOf(sessionId: string): string | undefined {
    return this.bySession.get(sessionId);
  }

  /** Every tab working in the repository that `sessionId` is in (itself included). */
  sessionsOf(sessionId: string): string[] {
    const id = this.bySession.get(sessionId);
    const repo = id ? this.repos.get(id) : undefined;
    return repo ? [...repo.sessions] : [sessionId];
  }

  private start(repo: Repo): void {
    if (this.deps.watch !== false) {
      // a folder inside a distribution is only reachable through the share, which does not report changes: poll there
      const reachable = repo.env.kind !== 'wsl' || /^[a-zA-Z]:/.test(repo.id.root);
      const gitDirFs = fsPathOf(repo.env, repo.id.gitDir);
      repo.watcher = new GitRepoWatcher({
        paths: reachable ? { gitDir: gitDirFs, commonDir: fsPathOf(repo.env, repo.id.commonDir) } : null,
        fingerprint: () =>
          !reachable && this.deps.signature ? this.deps.signature(repo.env, repo.cwd) : repoFingerprint(repo.env, repo.cwd, gitDirFs),
        onChange: (reason) => void this.externalChange(repo, reason),
        pollMs: (watching) => (watching ? 30_000 : this.focused ? 4000 : 20_000)
      });
      void repo.watcher.start().catch(() => undefined);
    }
    repo.interval = setInterval(() => {
      if (!this.focused && this.now() - this.blurredAt > FETCH_EVERY_MS) return; // nobody is looking
      if (this.deps.autoFetch()) this.scheduleFetch(repo.id.repoId, 'interval');
    }, FETCH_EVERY_MS);
    repo.interval.unref?.();
  }

  private stop(repo: Repo): void {
    repo.watcher?.dispose();
    if (repo.interval) clearInterval(repo.interval);
    if (repo.fetchTimer) clearTimeout(repo.fetchTimer);
    if (repo.activityTimer) clearTimeout(repo.activityTimer);
  }

  dispose(): void {
    for (const r of this.repos.values()) this.stop(r);
    this.repos.clear();
    this.bySession.clear();
    this.byCwd.clear();
  }

  /** An agent in this tab started or stopped working: the standing says whether files may change under the user. */
  agentChanged(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    const repo = id ? this.repos.get(id) : undefined;
    if (!repo || repo.activityTimer) return;
    repo.activityTimer = setTimeout(() => {
      repo.activityTimer = undefined;
      if (this.repos.get(repo.id.repoId) === repo) void this.compute(repo.id.repoId);
    }, 300);
    repo.activityTimer.unref?.();
  }

  // ---- unsaved editor buffers ----------------------------------------------------------------------------------------

  reportUnsaved(sessionId: string, rels: string[]): void {
    const repo = this.repos.get(this.bySession.get(sessionId) ?? '');
    if (!repo) return;
    const before = JSON.stringify(repo.unsaved.get(sessionId) ?? []);
    if (rels.length) repo.unsaved.set(sessionId, rels);
    else repo.unsaved.delete(sessionId);
    if (before !== JSON.stringify(rels) && repo.snapshot) {
      this.publish(repo, { ...repo.snapshot, unsavedInArctri: this.unsavedOf(repo) });
    }
  }

  private unsavedOf(repo: Repo): string[] {
    return [...new Set([...repo.unsaved.values()].flat())].sort();
  }

  // ---- the standing ----------------------------------------------------------------------------------------------------

  /** Reads the repository now (git is asked; nothing cached is trusted). */
  async compute(repoId: string): Promise<RepoSyncSnapshot | undefined> {
    const repo = this.repos.get(repoId);
    if (!repo) return undefined;
    const snap = await this.read(repo);
    this.publish(repo, snap);
    return snap;
  }

  private async read(repo: Repo): Promise<RepoSyncSnapshot> {
    const repoId = repo.id.repoId;
    const g = (args: string[]) => runGit(repo.env, repo.cwd, args, { timeoutMs: 20_000 });
    const [branchR, shaR, upR, statusR] = await Promise.all([
      g(['symbolic-ref', '-q', '--short', 'HEAD']),
      g(['rev-parse', '--verify', '-q', 'HEAD']),
      g(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
      g(['status', '--porcelain', '--untracked-files=normal'])
    ]);
    const detached = branchR.code !== 0;
    const branch = detached ? undefined : branchR.stdout.trim();
    const upstream = !detached && upR.code === 0 ? upR.stdout.trim() : undefined;
    let ahead: number | null = null;
    let behind: number | null = null;
    if (upstream) {
      const c = await g(['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
      const m = c.code === 0 ? /^(\d+)\s+(\d+)/.exec(c.stdout.trim()) : null;
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    }
    const status = statusR.code === 0 ? statusR.stdout : '';
    const busy = await this.operationInProgress(repo);
    const agents = [...repo.sessions].map((id) => this.deps.agentActivity(id));
    const remoteError = repo.remoteError;
    const snap: RepoSyncSnapshot = {
      repoId, repoRoot: repo.id.root,
      ...(branch ? { branch } : {}),
      ...(shaR.code === 0 ? { headSha: shaR.stdout.trim() } : {}),
      ...(upstream ? { upstream } : {}),
      ahead, behind,
      status: classifySync({
        detached, upstream, ahead, behind, fetching: !!repo.fetching,
        remoteError: !!remoteError, unknown: statusR.code !== 0 && shaR.code !== 0
      }),
      dirtyOnDisk: !!status.trim(),
      unsavedInArctri: this.unsavedOf(repo),
      activeAgent: agents.includes('active'),
      agentUnknown: agents.includes('unknown'),
      busy,
      conflicts: hasConflict(status),
      ...(repo.fetchedAt ? { fetchedAt: repo.fetchedAt } : {}),
      checkedAt: this.now(),
      ...(remoteError ? { remoteError } : {})
    };
    return snap;
  }

  /** The last reading, or a fresh one when there is none yet. */
  async status(sessionId: string): Promise<RepoSyncSnapshot | undefined> {
    const id = this.bySession.get(sessionId) ?? (await this.attach(sessionId));
    const repo = id ? this.repos.get(id) : undefined;
    if (!repo) return undefined;
    return repo.snapshot ?? this.compute(repo.id.repoId);
  }

  private publish(repo: Repo, snap: RepoSyncSnapshot): void {
    const changed = !sameSnapshot(repo.snapshot, snap);
    repo.snapshot = snap;
    if (changed) this.deps.emit('git:syncChanged', { repoId: repo.id.repoId, sessionIds: [...repo.sessions], snapshot: snap });
  }

  /** A merge, rebase, cherry-pick, revert or a lock file is in the way. */
  private async operationInProgress(repo: Repo): Promise<boolean> {
    const dir = fsPathOf(repo.env, repo.id.gitDir);
    const names = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'index.lock', 'HEAD.lock'];
    return names.some((n) => {
      try {
        return existsSync(join(dir, n));
      } catch {
        return false;
      }
    });
  }

  // ---- fetch -----------------------------------------------------------------------------------------------------------

  /** Asks the server what is new. Tabs that ask while one is running share it. */
  fetch(repoId: string): Promise<GitSyncResult> {
    const repo = this.repos.get(repoId);
    if (!repo) return Promise.resolve({ ok: false, code: 'FAILED', error: 'no repository' });
    if (repo.fetching) return repo.fetching;
    const job = (async (): Promise<GitSyncResult> => {
      const remotes = (await runGit(repo.env, repo.cwd, ['remote'])).stdout.trim();
      if (!remotes) return { ok: true, message: 'no remote' };
      const r = await gitFetch(repo.env, repo.cwd);
      if (r.ok) {
        repo.fetchedAt = this.now();
        delete repo.remoteError;
        return { ok: true };
      }
      const code = classifyRemoteError(r.error);
      repo.remoteError = { code, message: r.error };
      return { ok: false, code, error: r.error };
    })();
    repo.fetching = job;
    void this.compute(repoId); // shows "fetching"
    void job.finally(async () => {
      repo.fetching = undefined;
      await this.compute(repoId);
      await repo.watcher?.resync();
    });
    return job;
  }

  /** A fetch soon: bursts of reasons (open, focus, switch) become one, and a recent one is not repeated. */
  scheduleFetch(repoId: string, reason: 'open' | 'focus' | 'switch' | 'interval' | 'manual', delay = FETCH_DELAY_MS): void {
    const repo = this.repos.get(repoId);
    if (!repo || repo.fetching) return;
    if (reason !== 'manual' && repo.fetchedAt && this.now() - repo.fetchedAt < FETCH_GAP_MS) return;
    if (repo.fetchTimer) return;
    repo.fetchTimer = setTimeout(() => {
      repo.fetchTimer = undefined;
      if (this.repos.get(repoId) === repo) void this.fetch(repoId);
    }, delay);
    repo.fetchTimer.unref?.();
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    if (!focused) this.blurredAt = this.now();
    else if (this.deps.autoFetch()) for (const id of this.repos.keys()) this.scheduleFetch(id, 'focus');
  }

  // ---- the queue ---------------------------------------------------------------------------------------------------------

  /** Runs a git action that writes after the ones before it in the same worktree; a stuck one does not block forever. */
  queue<T>(repoId: string | undefined, fn: () => Promise<T>): Promise<T> {
    const repo = repoId ? this.repos.get(repoId) : undefined;
    if (!repo) return fn();
    const run = repo.tail.then(() =>
      Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(TIMEOUT), QUEUE_LIMIT_MS).unref?.())])
    );
    repo.tail = run.catch(() => undefined);
    return run.catch((e) => {
      if (e === TIMEOUT) throw new Error('git did not finish in time');
      throw e;
    });
  }

  /** After something changed the repository: every tab reads its branch, the standing is read again and views reload. */
  async invalidate(sessionId: string, reason: RepoChanged['reason'] = 'local'): Promise<void> {
    const id = this.bySession.get(sessionId);
    const repo = id ? this.repos.get(id) : undefined;
    const ids = repo ? [...repo.sessions] : [sessionId];
    for (const s of ids) this.deps.refreshBranch(s);
    if (repo) {
      await this.compute(repo.id.repoId);
      await repo.watcher?.resync(); // what Arctri did itself is not news
    }
    this.deps.emit('git:repoChanged', { sessionIds: ids, reason } satisfies RepoChanged);
  }

  /** The watcher saw HEAD or a ref move outside Arctri. */
  private async externalChange(repo: Repo, reason: RepoChanged['reason']): Promise<void> {
    const first = [...repo.sessions][0];
    if (!first || this.repos.get(repo.id.repoId) !== repo) return;
    const before = repo.snapshot;
    await this.invalidate(first, reason);
    if (before?.branch !== repo.snapshot?.branch && this.deps.autoFetch()) this.scheduleFetch(repo.id.repoId, 'switch');
  }

  // ---- checks before something that changes files ------------------------------------------------------------------------

  /** Why now is not the time to change the files under the user, in the order the user should hear it. */
  blockers(s: RepoSyncSnapshot): Array<{ code: GitSyncErrorCode; error: string }> {
    const out: Array<{ code: GitSyncErrorCode; error: string }> = [];
    const add = (code: GitSyncErrorCode, error: string) => out.push({ code, error });
    if (s.status === 'detached') add('DETACHED', 'HEAD is not on a branch');
    else if (!s.upstream) add('NO_UPSTREAM', 'this branch does not track a remote branch');
    if (s.busy) add('GIT_BUSY', 'git is in the middle of an operation or locked by another process');
    if (s.conflicts) add('CONFLICTS', 'there are unresolved conflicts');
    if (s.dirtyOnDisk) add('DIRTY_WORKTREE', 'there are uncommitted changes');
    if (s.unsavedInArctri.length) add('UNSAVED_EDITOR', 'there are unsaved edits in the editor');
    if (s.activeAgent) add('AGENT_ACTIVE', 'an agent is working in this folder');
    return out;
  }

  /** The reading and the changed paths for the dialog shown before an agent starts. */
  async preWork(env: EnvironmentRef, cwd: string): Promise<PreWorkCheck> {
    const identity = await resolveRepo(env, cwd);
    if (!identity) return { snapshot: null, dirtyFiles: [] };
    // a folder no tab works in yet is read without being registered
    const repo = this.repos.get(identity.repoId);
    const snapshot = repo
      ? await this.compute(identity.repoId)
      : await this.read({ id: identity, env, cwd, sessions: new Set(), unsaved: new Map(), tail: Promise.resolve() });
    const status = await runGit(env, cwd, ['status', '--porcelain', '--untracked-files=normal']);
    return { snapshot: snapshot ?? null, dirtyFiles: status.code === 0 ? porcelainPaths(status.stdout).slice(0, 10) : [] };
  }

  /**
   * Brings the current branch up to its upstream by fast-forward, or explains why not. The branch the user saw is
   * checked again here, after the fetch, so nothing is done to a branch they were not looking at.
   */
  updateSafe(sessionId: string, expect: { head?: string | undefined; upstream?: string | undefined }): Promise<GitSyncResult> {
    const repoId = this.bySession.get(sessionId);
    const repo = repoId ? this.repos.get(repoId) : undefined;
    if (!repo || !repoId) return Promise.resolve({ ok: false, code: 'FAILED', error: 'no repository' });
    const fail = (code: GitSyncErrorCode, error: string): GitSyncResult => ({ ok: false, code, error });
    return this.queue(repoId, async () => {
      const check = async (): Promise<RepoSyncSnapshot | GitSyncResult> => {
        const s = await this.compute(repoId);
        if (!s) return fail('FAILED', 'could not read the repository');
        if ((expect.head && s.headSha !== expect.head) || (expect.upstream && s.upstream !== expect.upstream)) {
          return fail('BRANCH_CHANGED', 'the branch changed since you looked: check it again');
        }
        const blocked = this.blockers(s)[0];
        return blocked ? fail(blocked.code, blocked.error) : s;
      };
      const first = await check();
      if ('ok' in first) return first;
      const fetched = await this.fetch(repoId);
      if (!fetched.ok) return fetched;
      const second = await check();
      if ('ok' in second) return second;
      if (second.ahead && second.behind) return fail('DIVERGED', 'manual resolution required: local and remote both have new commits');
      if (!second.behind) return { ok: true, message: second.ahead ? 'ahead' : 'up-to-date' };
      const r = await runGit(repo.env, repo.cwd, ['merge', '--ff-only', '@{upstream}'], { timeoutMs: 120_000 });
      await this.invalidate(sessionId, 'update');
      return r.code === 0 ? { ok: true, message: 'updated' } : fail('FAILED', errorText(r));
    });
  }
}

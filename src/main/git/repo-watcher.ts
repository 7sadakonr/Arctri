import { existsSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { EnvironmentRef } from '@shared/types/env';
import type { RepoChanged } from '@shared/git/sync';
import { runGit } from './actions';

/** In-progress operations whose marker files live in the git directory. */
const OPERATION_FILES = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];

/**
 * What a branch switch, commit, pull or reset (from any program) changes: the current branch, its commit, its upstream
 * and how far apart they are. One git call. Null when git cannot answer right now (a lock, a slow disk).
 * The index is left out on purpose: editors stage and refresh it all the time.
 */
export async function repoFingerprint(env: EnvironmentRef, cwd: string, gitDirFs: string): Promise<string | null> {
  const refs = await runGit(env, cwd, ['for-each-ref', '--format=%(HEAD)\t%(refname:short)\t%(objectname)\t%(upstream)\t%(upstream:track)', 'refs/heads'], { timeoutMs: 15_000 });
  if (refs.code !== 0) return null;
  let head = refs.stdout.split('\n').find((l) => l.startsWith('*'))?.slice(2);
  if (head === undefined) {
    const sha = await runGit(env, cwd, ['rev-parse', '--verify', '-q', 'HEAD'], { timeoutMs: 15_000 });
    head = `(detached)\t${sha.stdout.trim()}\t\t`;
  }
  const ops = OPERATION_FILES.filter((f) => {
    try {
      return existsSync(join(gitDirFs, f));
    } catch {
      return false;
    }
  });
  return `${head}\t${ops.join(',')}`;
}

/** Why the fingerprint changed, in terms of what the views reload. */
export function changeReason(before: string | undefined, after: string): RepoChanged['reason'] {
  const [b1, b2] = (before ?? '').split('\t');
  const [a1, a2] = after.split('\t');
  if (b1 !== a1) return 'branch';
  if (b2 !== a2) return 'head';
  return 'refs';
}

export interface WatcherOptions {
  /** Folders to watch with the operating system (null: watching is not reliable here, only polling is used). */
  paths: { gitDir: string; commonDir: string } | null;
  fingerprint(): Promise<string | null>;
  onChange(reason: RepoChanged['reason']): void;
  /** How long to wait after the last event before looking. */
  debounceMs?: number;
  /** How long between looks when nothing was heard: a safety net when watching, the only way when not. */
  pollMs(watching: boolean): number;
  watch?: typeof fsWatch;
}

const IGNORED = /^(index|index\.lock|objects|gc\.log|hooks|logs|lfs|info|COMMIT_EDITMSG|config\.lock)(\/|\\|$)/;

/**
 * Notices that the repository moved on without Arctri. An event only means "look": the actual state is read from git and
 * compared with the last reading, so a burst of events, or an event that changed nothing that matters, is one callback or none.
 */
export class GitRepoWatcher {
  private watchers: FSWatcher[] = [];
  private last: string | undefined;
  private debounce?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setTimeout>;
  private checking = false;
  private again = false;
  private disposed = false;

  constructor(private readonly o: WatcherOptions) {}

  async start(): Promise<void> {
    this.last = (await this.o.fingerprint()) ?? undefined;
    if (this.disposed) return;
    const watch = this.o.watch ?? fsWatch;
    const paths = this.o.paths;
    if (paths) {
      const targets: Array<[string, boolean]> = [[paths.gitDir, false], [paths.commonDir, false], [join(paths.commonDir, 'refs'), true]];
      for (const [dir, recursive] of targets) {
        try {
          const w = watch(dir, { persistent: false, recursive }, (_event, file) => {
            if (!file || !IGNORED.test(String(file))) this.schedule();
          });
          // a folder that cannot be watched any more leaves the polling to catch up
          w.on('error', () => w.close());
          this.watchers.push(w);
        } catch {
          /* not watchable: polling covers it */
        }
      }
    }
    this.loop();
  }

  private loop(): void {
    if (this.disposed) return;
    this.poll = setTimeout(() => {
      void this.check().finally(() => this.loop());
    }, this.o.pollMs(this.watchers.length > 0));
    this.poll.unref?.();
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.check();
    }, this.o.debounceMs ?? 300);
    this.debounce.unref?.();
  }

  private async check(): Promise<void> {
    if (this.disposed) return;
    if (this.checking) {
      this.again = true;
      return;
    }
    this.checking = true;
    try {
      const now = await this.o.fingerprint();
      if (this.disposed || now === null) return;
      if (this.last !== undefined && now !== this.last) {
        const reason = changeReason(this.last, now);
        this.last = now;
        this.o.onChange(reason);
      } else this.last = now;
    } finally {
      this.checking = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }

  /** Arctri changed the repository itself and already told everyone: take the new state as the baseline without a callback. */
  async resync(): Promise<void> {
    const now = await this.o.fingerprint();
    if (!this.disposed && now !== null) this.last = now;
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounce) clearTimeout(this.debounce);
    if (this.poll) clearTimeout(this.poll);
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}

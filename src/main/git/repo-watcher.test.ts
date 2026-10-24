import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EnvironmentRef } from '@shared/types/env';
import type { RepoChanged } from '@shared/git/sync';
import { changeReason, GitRepoWatcher, repoFingerprint } from './repo-watcher';
import { commitFile, git, makeRemote } from './sync-test-repos';

const env: EnvironmentRef = { kind: 'local' };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const open: GitRepoWatcher[] = [];
afterEach(() => open.splice(0).forEach((w) => w.dispose()));

async function watcher(dir: string, extra: { noWatch?: boolean } = {}) {
  const seen: Array<RepoChanged['reason']> = [];
  const gitDir = join(dir, '.git');
  const w = new GitRepoWatcher({
    paths: extra.noWatch ? null : { gitDir, commonDir: gitDir },
    fingerprint: () => repoFingerprint(env, dir, gitDir),
    onChange: (r) => seen.push(r),
    debounceMs: 40,
    pollMs: (watching) => (watching ? 60_000 : 60)
  });
  open.push(w);
  await w.start();
  return { w, seen };
}

describe('GitRepoWatcher', () => {
  it('reports a branch switch, a commit and a reset made from outside, once each', async () => {
    const { a } = makeRemote();
    const { seen } = await watcher(a);
    git(a, 'switch', '-q', '-c', 'topic');
    await wait(700);
    expect(seen).toEqual(['branch']);
    commitFile(a, 'x.txt', 'x');
    await wait(700);
    expect(seen).toEqual(['branch', 'head']);
    git(a, 'reset', '-q', '--hard', 'HEAD~1');
    await wait(700);
    expect(seen).toEqual(['branch', 'head', 'head']);
  }, 15_000);

  it('says nothing when only the index changes', async () => {
    const { a } = makeRemote();
    const { seen } = await watcher(a);
    writeFileSync(join(a, 'new.txt'), 'n');
    git(a, 'add', 'new.txt');
    git(a, 'status');
    await wait(700);
    expect(seen).toEqual([]);
  }, 15_000);

  it('notices a fetch from another program as a change of refs', async () => {
    const { a, b } = makeRemote();
    const { seen } = await watcher(a);
    commitFile(b, 'y.txt', 'y');
    git(b, 'push', '-q');
    git(a, 'fetch', '-q');
    await wait(700);
    expect(seen).toEqual(['refs']);
  }, 15_000);

  it('still notices by polling when watching is not available', async () => {
    const { a } = makeRemote();
    const { seen } = await watcher(a, { noWatch: true });
    git(a, 'switch', '-q', '-c', 'polled');
    await wait(500);
    expect(seen).toEqual(['branch']);
  }, 15_000);

  it('survives folders that cannot be watched', async () => {
    const { a } = makeRemote();
    const gitDir = join(a, '.git');
    const seen: string[] = [];
    const w = new GitRepoWatcher({
      paths: { gitDir, commonDir: gitDir },
      fingerprint: () => repoFingerprint(env, a, gitDir),
      onChange: (r) => seen.push(r),
      debounceMs: 40,
      pollMs: (watching) => (watching ? 60_000 : 60),
      watch: () => { throw new Error('ENOSPC'); }
    });
    open.push(w);
    await w.start();
    git(a, 'switch', '-q', '-c', 'fallback');
    await wait(500);
    expect(seen).toEqual(['branch']);
  }, 15_000);

  it('does not call back for its own changes after resync, nor after dispose', async () => {
    const { a } = makeRemote();
    const { w, seen } = await watcher(a);
    git(a, 'switch', '-q', '-c', 'mine');
    await w.resync();
    await wait(500);
    expect(seen).toEqual([]);
    w.dispose();
    git(a, 'switch', '-q', 'main');
    await wait(400);
    expect(seen).toEqual([]);
  }, 15_000);
});

describe('changeReason', () => {
  it('names what moved', () => {
    expect(changeReason('main\ta\tu\t\t', 'topic\ta\tu\t\t')).toBe('branch');
    expect(changeReason('main\ta\tu\t\t', 'main\tb\tu\t\t')).toBe('head');
    expect(changeReason('main\ta\tu\t\t', 'main\ta\tu\t[behind 1]\t')).toBe('refs');
  });
});


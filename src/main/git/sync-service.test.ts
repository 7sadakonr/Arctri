import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EnvironmentRef } from '@shared/types/env';
import { GitSyncService, type AgentActivity } from './sync-service';
import { commitFile, git, makeRemote } from './sync-test-repos';

const env: EnvironmentRef = { kind: 'local' };
const services: GitSyncService[] = [];

function setup(dirs: Record<string, string>, agent: (id: string) => AgentActivity = () => 'idle') {
  const events: Array<{ channel: string; payload: unknown }> = [];
  const svc = new GitSyncService({
    session: (id) => (dirs[id] ? { env, cwd: dirs[id]! } : undefined),
    agentActivity: agent,
    emit: (channel, payload) => events.push({ channel, payload }),
    refreshBranch: () => undefined,
    autoFetch: () => false
  });
  services.push(svc);
  return { svc, events };
}
afterEach(() => services.splice(0).forEach((s) => s.dispose()));

describe('GitSyncService', () => {
  it('shares one repository between tabs and tells worktrees apart', async () => {
    const { a } = makeRemote();
    const wt = join(mkdtempSync(join(tmpdir(), 'arctri-wt-')), 'wt');
    git(a, 'worktree', 'add', '-q', '-b', 'other', wt);
    const { svc } = setup({ t1: a, t2: a, t3: wt });
    const [r1, r2, r3] = await Promise.all([svc.attach('t1'), svc.attach('t2'), svc.attach('t3')]);
    expect(r1).toBeTruthy();
    expect(r1).toBe(r2);
    expect(r3).not.toBe(r1);
    expect(svc.sessionsOf('t1').sort()).toEqual(['t1', 't2']);
  });

  it('finds out it is behind only after fetching, and leaves the files alone', async () => {
    const { a, b } = makeRemote();
    for (const n of ['2', '3', '4']) commitFile(b, `f${n}.txt`, n);
    git(b, 'push', '-q');
    const { svc } = setup({ t1: a });
    const id = (await svc.attach('t1'))!;
    expect((await svc.compute(id))!.status).toBe('up-to-date'); // not fetched yet: honest about what it knows
    expect((await svc.fetch(id)).ok).toBe(true);
    const s = (await svc.compute(id))!;
    expect(s).toMatchObject({ status: 'behind', behind: 3, ahead: 0, upstream: 'origin/main' });
    expect(s.fetchedAt).toBeTypeOf('number');
    expect(existsSync(join(a, 'f2.txt'))).toBe(false);
  });

  it('runs one fetch for tabs that ask together', async () => {
    const { a } = makeRemote();
    const { svc } = setup({ t1: a, t2: a });
    const id = (await svc.attach('t1'))!;
    await svc.attach('t2');
    const p1 = svc.fetch(id);
    expect(svc.fetch(id)).toBe(p1);
    await p1;
  });

  it('reports ahead, diverged, no upstream and detached', async () => {
    const { a, b } = makeRemote();
    commitFile(a, 'x.txt', 'x');
    const { svc } = setup({ t1: a });
    const id = (await svc.attach('t1'))!;
    expect((await svc.compute(id))!).toMatchObject({ status: 'ahead', ahead: 1 });
    commitFile(b, 'y.txt', 'y');
    git(b, 'push', '-q');
    await svc.fetch(id);
    expect((await svc.compute(id))!).toMatchObject({ status: 'diverged', ahead: 1, behind: 1 });
    git(a, 'switch', '-q', '-c', 'local-only');
    expect((await svc.compute(id))!.status).toBe('no-upstream');
    git(a, 'switch', '-q', '--detach');
    expect((await svc.compute(id))!.status).toBe('detached');
  });

  it('does not call a failed fetch up to date', async () => {
    const { a, remote } = makeRemote();
    const { svc } = setup({ t1: a });
    const id = (await svc.attach('t1'))!;
    git(a, 'remote', 'set-url', 'origin', join(remote, 'gone'));
    const r = await svc.fetch(id);
    expect(r).toMatchObject({ ok: false, code: 'OFFLINE' });
    const s = (await svc.compute(id))!;
    expect(s.status).toBe('offline');
    expect(s.remoteError?.code).toBe('OFFLINE');
  });

  it('runs queued actions one after another', async () => {
    const { a } = makeRemote();
    const { svc } = setup({ t1: a });
    const id = (await svc.attach('t1'))!;
    const order: string[] = [];
    const slow = svc.queue(id, async () => {
      await new Promise((r) => setTimeout(r, 40));
      order.push('first');
    });
    const fast = svc.queue(id, async () => void order.push('second'));
    await Promise.all([slow, fast]);
    expect(order).toEqual(['first', 'second']);
    await expect(svc.queue(id, () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await svc.queue(id, async () => void order.push('after a failure'));
    expect(order.at(-1)).toBe('after a failure');
  });
});

describe('GitSyncService.updateSafe', () => {
  const behindBy = (b: string, n: number) => {
    for (let i = 0; i < n; i++) commitFile(b, `n${i}.txt`, String(i));
    git(b, 'push', '-q');
  };

  it('fast-forwards a clean branch that is behind', async () => {
    const { a, b } = makeRemote();
    behindBy(b, 2);
    const { svc, events } = setup({ t1: a });
    await svc.attach('t1');
    const r = await svc.updateSafe('t1', {});
    expect(r).toMatchObject({ ok: true, message: 'updated' });
    expect(readFileSync(join(a, 'n1.txt'), 'utf8')).toBe('1');
    expect(git(a, 'status', '--porcelain')).toBe('');
    expect(events.some((e) => e.channel === 'git:repoChanged')).toBe(true);
  });

  it('refuses a dirty tree, untracked files, a conflict, unsaved edits and a working agent without changing anything', async () => {
    const { a, b } = makeRemote();
    behindBy(b, 1);
    let agent: AgentActivity = 'idle';
    const { svc } = setup({ t1: a }, () => agent);
    await svc.attach('t1');
    const head = git(a, 'rev-parse', 'HEAD');
    const refused = async (code: string) => {
      const r = await svc.updateSafe('t1', {});
      expect(r).toMatchObject({ ok: false, code });
      expect(git(a, 'rev-parse', 'HEAD')).toBe(head);
    };

    writeFileSync(join(a, 'one.txt'), 'changed');
    await refused('DIRTY_WORKTREE');
    git(a, 'checkout', '--', 'one.txt');

    writeFileSync(join(a, 'new.txt'), 'untracked');
    await refused('DIRTY_WORKTREE');
    expect(readFileSync(join(a, 'new.txt'), 'utf8')).toBe('untracked');
    rmSync(join(a, 'new.txt'));

    svc.reportUnsaved('t1', ['one.txt']);
    await refused('UNSAVED_EDITOR');
    svc.reportUnsaved('t1', []);

    agent = 'active';
    await refused('AGENT_ACTIVE');
    agent = 'idle';

    expect(await svc.updateSafe('t1', {})).toMatchObject({ ok: true, message: 'updated' });
  });

  it('refuses a diverged branch and never merges', async () => {
    const { a, b } = makeRemote();
    commitFile(a, 'mine.txt', 'm');
    behindBy(b, 1);
    const { svc } = setup({ t1: a });
    await svc.attach('t1');
    const head = git(a, 'rev-parse', 'HEAD');
    expect(await svc.updateSafe('t1', {})).toMatchObject({ ok: false, code: 'DIVERGED' });
    expect(git(a, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('refuses a branch without upstream, offline, and a branch that is not the one the user saw', async () => {
    const { a, b, remote } = makeRemote();
    behindBy(b, 1);
    const { svc } = setup({ t1: a });
    const id = (await svc.attach('t1'))!;
    const seen = (await svc.compute(id))!;
    expect(await svc.updateSafe('t1', { head: 'deadbeef' })).toMatchObject({ ok: false, code: 'BRANCH_CHANGED' });
    expect(seen.headSha).toBeTruthy();

    git(a, 'remote', 'set-url', 'origin', join(remote, 'gone'));
    expect(await svc.updateSafe('t1', { head: seen.headSha, upstream: seen.upstream })).toMatchObject({ ok: false, code: 'OFFLINE' });
    git(a, 'remote', 'set-url', 'origin', remote);

    git(a, 'switch', '-q', '-c', 'local-only');
    expect(await svc.updateSafe('t1', {})).toMatchObject({ ok: false, code: 'NO_UPSTREAM' });
  });

  it('stops at once when git is locked', async () => {
    const { a, b } = makeRemote();
    behindBy(b, 1);
    const { svc } = setup({ t1: a });
    await svc.attach('t1');
    writeFileSync(join(a, '.git', 'index.lock'), '');
    const t = Date.now();
    expect(await svc.updateSafe('t1', {})).toMatchObject({ ok: false, code: 'GIT_BUSY' });
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EnvironmentRef } from '@shared/types/env';
import { gitCommit, gitCreateBranch, gitFetch, gitInvocations, gitPull, gitPush, gitStage, gitUnstage, safePaths, validBranchName } from './actions';

describe('validBranchName', () => {
  it('accepts ordinary names and refuses anything git or a command line would trip on', () => {
    for (const ok of ['main', 'feature/x', 'fix_1.2', 'release/0.2.0', 'a+b']) expect(validBranchName(ok), ok).toBe(true);
    for (const bad of ['', '-x', 'a b', 'a..b', 'a//b', 'x/', 'x.', 'x.lock', '.hidden', 'a/.b', 'a$(b)', 'a;b', "a'b"]) expect(validBranchName(bad), bad).toBe(false);
  });
});

describe('safePaths', () => {
  it('only takes relative paths that stay inside the folder', () => {
    expect(safePaths(['src/a.ts', 'b.txt'])).toBe(true);
    expect(safePaths([])).toBe(false);
    expect(safePaths(['../x'])).toBe(false);
    expect(safePaths(['a/../../x'])).toBe(false);
    expect(safePaths(['/etc/passwd'])).toBe(false);
    expect(safePaths(['C:\\x'])).toBe(false);
  });
});

describe('gitInvocations', () => {
  it('picks git for Windows for Windows folders and for Windows drives seen from WSL, with WSL git as the fallback', () => {
    const win: EnvironmentRef = { kind: 'windows' };
    expect(gitInvocations(win, 'C:\\p', ['status'])).toEqual([{ file: 'git', argv: ['-C', 'C:\\p', 'status'] }]);
    const wsl: EnvironmentRef = { kind: 'wsl', distro: 'Ubuntu' };
    const onDrive = gitInvocations(wsl, '/mnt/d/p', ['status']);
    expect(onDrive).toHaveLength(2);
    expect(onDrive[0]).toEqual({ file: 'git', argv: ['-C', 'D:\\p', 'status'] });
    expect(onDrive[1]!.argv.slice(0, 3)).toEqual(['-d', 'Ubuntu', '--exec']);
    const inDistro = gitInvocations(wsl, '/home/me/p', ['status']);
    expect(inDistro).toHaveLength(1);
    expect(inDistro[0]!.argv.slice(-4)).toEqual(['git', '-C', '/home/me/p', 'status']);
  });
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

describe('git actions on a real repository', () => {
  it('stages, unstages, commits (multi-line Thai message), makes a branch and publishes it', async () => {
    const env: EnvironmentRef = { kind: 'windows' };
    const remote = mkdtempSync(join(tmpdir(), 'arctri-remote-'));
    git(remote, 'init', '--bare', '-b', 'main');
    const dir = mkdtempSync(join(tmpdir(), 'arctri-actions-'));
    git(dir, 'init', '-b', 'main');
    git(dir, 'config', 'user.email', 't@example.com');
    git(dir, 'config', 'user.name', 'Tester');
    git(dir, 'remote', 'add', 'origin', remote);
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    writeFileSync(join(dir, 'b.txt'), 'two\n');

    // a repository without commits: stage and unstage still work
    expect((await gitStage(env, dir, ['a.txt'])).ok).toBe(true);
    expect(git(dir, 'status', '--short')).toContain('A  a.txt');
    expect((await gitUnstage(env, dir, ['a.txt'])).ok).toBe(true);
    expect(git(dir, 'status', '--short')).toContain('?? a.txt');

    // nothing staged: committing refuses; ticking everything first commits it
    expect((await gitCommit(env, dir, 'x')).ok).toBe(false);
    expect((await gitStage(env, dir, 'all')).ok).toBe(true);
    const msg = 'เพิ่มไฟล์แรก\n\nรายละเอียดหลายบรรทัด "quoted" $HOME';
    expect((await gitCommit(env, dir, msg)).ok).toBe(true);
    expect(git(dir, 'log', '-1', '--format=%B').trim()).toBe(msg);
    expect(git(dir, 'ls-files').split('\n').filter(Boolean).sort()).toEqual(['a.txt', 'b.txt']);

    // with something staged only that is committed; unstage all puts it back
    writeFileSync(join(dir, 'a.txt'), 'one\nmore\n');
    writeFileSync(join(dir, 'b.txt'), 'two\nmore\n');
    expect((await gitStage(env, dir, ['b.txt'])).ok).toBe(true);
    expect((await gitUnstage(env, dir, 'all')).ok).toBe(true);
    expect(git(dir, 'diff', '--cached', '--name-only').trim()).toBe('');
    expect((await gitStage(env, dir, ['b.txt'])).ok).toBe(true);
    expect((await gitCommit(env, dir, 'only b')).ok).toBe(true);
    expect(git(dir, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('b.txt');

    // refusals
    expect((await gitCommit(env, dir, '   ')).ok).toBe(false);
    expect(await gitCreateBranch(env, dir, 'bad name')).toMatchObject({ ok: false });
    const failed = await gitStage(env, dir, ['../outside']);
    expect(failed.ok).toBe(false);

    // new branch, then publish (sets the upstream); a second push has nothing to do but still succeeds
    expect((await gitCreateBranch(env, dir, 'feature/x')).ok).toBe(true);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/x');
    const pushed = await gitPush(env, dir);
    expect(pushed.ok, JSON.stringify(pushed)).toBe(true);
    expect(git(remote, 'branch', '--list').replace(/\s|\*/g, '')).toContain('featurex'.replace('featurex', 'feature/x'));
    expect(git(dir, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe('origin/feature/x');
    expect((await gitPush(env, dir)).ok).toBe(true);

    // someone else pushes to the same branch: fetch learns of it, pull brings it in
    const other = mkdtempSync(join(tmpdir(), 'arctri-other-'));
    git(other, 'clone', '-q', remote, '.');
    git(other, 'config', 'user.email', 'o@example.com');
    git(other, 'config', 'user.name', 'Other');
    git(other, 'switch', 'feature/x');
    writeFileSync(join(other, 'c.txt'), 'three\n');
    git(other, 'add', '.');
    git(other, 'commit', '-m', 'from someone else');
    git(other, 'push', '-q');
    expect((await gitFetch(env, dir)).ok).toBe(true);
    expect(git(dir, 'rev-list', '--count', 'HEAD..@{u}').trim()).toBe('1');
    expect((await gitPull(env, dir)).ok).toBe(true);
    expect(git(dir, 'log', '-1', '--format=%s').trim()).toBe('from someone else');
  }, 60_000);
});

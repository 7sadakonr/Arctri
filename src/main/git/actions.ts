import { spawn } from 'node:child_process';
import type { EnvironmentRef } from '@shared/types/env';
import { drvfsToWindows } from '../env-query/service';
import { wslExePath } from '../wsl/wsl-manager';

export type GitResult = { ok: true; out: string } | { ok: false; error: string };

interface Raw {
  code: number;
  stdout: string;
  stderr: string;
}

/** A branch name git accepts and that is safe as a single argument (no spaces, no leading dash, no `..`). */
export function validBranchName(name: string): boolean {
  if (!/^[A-Za-z0-9_][\w./+-]*$/.test(name) || name.length > 200) return false;
  if (name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  return !name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'));
}

/** Relative paths only, inside the folder: what the sidebar sends for stage/unstage. */
export function safePaths(paths: string[]): boolean {
  return paths.length > 0 && paths.every((p) => !!p && !/^([a-zA-Z]:)?[\\/]/.test(p) && !p.split(/[\\/]/).includes('..') && !p.includes('\0'));
}

export interface Invocation {
  file: string;
  argv: string[];
}

/** Which program runs `git` for this folder: git for Windows (also for a Windows drive seen from WSL), else git inside the distribution. */
export function gitInvocations(env: EnvironmentRef, cwd: string, args: string[], extraEnv: Record<string, string> = {}): Invocation[] {
  const windows = (dir: string): Invocation => ({ file: 'git', argv: ['-C', dir, ...args] });
  if (env.kind !== 'wsl') return [windows(cwd)];
  const inWsl: Invocation = {
    file: wslExePath(),
    argv: ['-d', env.distro, '--exec', 'env', 'GIT_TERMINAL_PROMPT=0', ...Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`), 'git', '-C', cwd, ...args]
  };
  const win = drvfsToWindows(cwd);
  return win ? [windows(win), inWsl] : [inWsl];
}

function spawnOnce(inv: Invocation, stdin: string | undefined, timeoutMs: number, extraEnv: Record<string, string>): Promise<Raw & { missing?: boolean }> {
  return new Promise((resolve) => {
    const p = spawn(inv.file, inv.argv, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', ...extraEnv }
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r: Raw & { missing?: boolean }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      p.kill();
      finish({ code: -1, stdout, stderr: stderr || 'git did not finish in time' });
    }, timeoutMs);
    p.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    p.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    p.stdin.on('error', () => undefined);
    p.on('error', (e: NodeJS.ErrnoException) => finish({ code: -1, stdout, stderr: e.message, missing: e.code === 'ENOENT' }));
    p.on('close', (code) => finish({ code: code ?? -1, stdout, stderr }));
    p.stdin.end(stdin ?? '');
  });
}

/** Runs git; a program that is not installed (git for Windows missing) falls back to the next way of running it. */
export async function runGit(
  env: EnvironmentRef, cwd: string, args: string[], opts: { stdin?: string; timeoutMs?: number; env?: Record<string, string> } = {}
): Promise<Raw> {
  let last: Raw = { code: -1, stdout: '', stderr: 'git is not available' };
  for (const inv of gitInvocations(env, cwd, args, opts.env)) {
    last = await spawnOnce(inv, opts.stdin, opts.timeoutMs ?? 30_000, opts.env ?? {});
    if (!(last as { missing?: boolean }).missing) return last;
  }
  return last;
}

/** The part of git's complaint worth showing: its `fatal:`/`error:` lines, or the first lines. */
export function errorText(r: Raw): string {
  const lines = (r.stderr || r.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const key = lines.filter((l) => /^(fatal|error|hint):/i.test(l) && !/^hint:\s*$/.test(l));
  return (key.length ? key : lines).slice(0, 3).join(' ').slice(0, 400) || 'git failed';
}

const result = (r: Raw): GitResult => (r.code === 0 ? { ok: true, out: r.stdout } : { ok: false, error: errorText(r) });

export async function gitStage(env: EnvironmentRef, cwd: string, paths: string[] | 'all'): Promise<GitResult> {
  if (paths !== 'all' && !safePaths(paths)) return { ok: false, error: 'invalid path' };
  return result(await runGit(env, cwd, paths === 'all' ? ['add', '-A'] : ['add', '--', ...paths]));
}

export async function gitUnstage(env: EnvironmentRef, cwd: string, paths: string[] | 'all'): Promise<GitResult> {
  if (paths !== 'all' && !safePaths(paths)) return { ok: false, error: 'invalid path' };
  const hasHead = (await runGit(env, cwd, ['rev-parse', '--verify', '-q', 'HEAD'])).code === 0;
  const args = hasHead
    ? paths === 'all' ? ['reset', '-q'] : ['restore', '--staged', '--', ...paths]
    : paths === 'all' ? ['rm', '--cached', '-r', '-q', '--', '.'] : ['rm', '--cached', '-r', '-q', '--', ...paths];
  return result(await runGit(env, cwd, args));
}

/** Commits what is staged (ticked in the Changes list); with nothing staged it refuses rather than guessing what was meant. */
export async function gitCommit(env: EnvironmentRef, cwd: string, message: string): Promise<GitResult> {
  if (!message.trim()) return { ok: false, error: 'empty message' };
  const staged = await runGit(env, cwd, ['diff', '--cached', '--quiet']);
  if (staged.code === 0) return { ok: false, error: 'no files ticked' };
  if (staged.code !== 1) return { ok: false, error: errorText(staged) };
  return result(await runGit(env, cwd, ['commit', '-F', '-'], { stdin: message.endsWith('\n') ? message : `${message}\n`, timeoutMs: 120_000 }));
}

export async function gitCreateBranch(env: EnvironmentRef, cwd: string, name: string): Promise<GitResult> {
  if (!validBranchName(name)) return { ok: false, error: 'invalid branch name' };
  return result(await runGit(env, cwd, ['switch', '-c', name]));
}

/** `git push`, or `git push -u <remote> <branch>` when the branch has no upstream yet. */
export async function gitPush(env: EnvironmentRef, cwd: string): Promise<GitResult> {
  const upstream = await runGit(env, cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (upstream.code === 0) return result(await runGit(env, cwd, ['push'], { timeoutMs: 180_000 }));
  const branch = (await runGit(env, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  if (!branch || branch === 'HEAD') return { ok: false, error: 'not on a branch' };
  const remotes = (await runGit(env, cwd, ['remote'])).stdout.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  if (!remote) return { ok: false, error: 'no remote configured' };
  return result(await runGit(env, cwd, ['push', '-u', remote, branch], { timeoutMs: 180_000 }));
}

/** `git fetch --prune`: learns what is new on the server without touching the files. */
export async function gitFetch(env: EnvironmentRef, cwd: string): Promise<GitResult> {
  return result(await runGit(env, cwd, ['fetch', '--prune'], { timeoutMs: 180_000 }));
}

/** `git pull --ff-only`: brings in new commits, but never makes a merge commit or leaves conflicts behind; git's words explain a refusal. */
export async function gitPull(env: EnvironmentRef, cwd: string): Promise<GitResult> {
  return result(await runGit(env, cwd, ['pull', '--ff-only'], { timeoutMs: 180_000 }));
}

/**
 * Switches to a branch. A remote branch (`origin/x`) is switched to as a local one that tracks it, reusing the local
 * branch of that name when there already is one. Git refuses when changes would be overwritten; its words are the error.
 */
export async function gitSwitch(env: EnvironmentRef, cwd: string, name: string, remote: boolean): Promise<GitResult> {
  if (!validBranchName(name)) return { ok: false, error: 'invalid branch name' };
  if (!remote) return result(await runGit(env, cwd, ['switch', name]));
  const local = name.replace(/^[^/]+\//, '');
  if (!validBranchName(local)) return { ok: false, error: 'invalid branch name' };
  const exists = (await runGit(env, cwd, ['rev-parse', '--verify', '-q', `refs/heads/${local}`])).code === 0;
  return result(await runGit(env, cwd, exists ? ['switch', local] : ['switch', '--track', name]));
}

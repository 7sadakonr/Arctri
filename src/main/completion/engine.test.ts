import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@shared/types/session';
import type { EnvironmentRef } from '@shared/types/env';
import { openDb } from '../persistence/db';
import { HistoryRepo } from '../persistence/history-repo';
import { EnvironmentQueryService, windowsGitBranches, type EnvironmentQuery } from '../env-query/service';
import { CompletionEngine } from './engine';

function makeInfo(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: 's', title: 't', titleSource: 'auto', profileId: 'x', env: { kind: 'windows' }, shell: 'pwsh', kind: 'shell',
    presentation: 'blocks', integration: 'active', phase: 'editing', pid: 1, state: 'running', nonce: 'n', createdAt: 0, ...over
  };
}

function setup(info: SessionInfo, env: EnvironmentQuery) {
  const history = new HistoryRepo(openDb(':memory:').db);
  const engine = new CompletionEngine({ sessions: { get: () => info }, history, env });
  const ask = (line: string, cursor = line.length) => engine.query({ requestId: 1, sessionId: 's', line, cursor });
  return { history, ask };
}

class FakeEnv implements EnvironmentQuery {
  files = new Map<string, { name: string; isDir: boolean }[]>();
  texts = new Map<string, string>();
  branches = ['main', 'feature/แก้บั๊ก', 'origin/main'];
  exes = ['git', 'node', 'npm', 'pnpm', 'python'];
  calls: string[] = [];
  async listDir(_e: EnvironmentRef, dir: string) { this.calls.push(`ls ${dir}`); return this.files.get(dir) ?? []; }
  async readSmallText(_e: EnvironmentRef, f: string) { return this.texts.get(f) ?? null; }
  async gitBranches() { return this.branches; }
  async gitBranch() { return 'main'; }
  async listExecutables() { return this.exes; }
  async homeDir() { return '/home/me'; }
  async gitChanges() { return undefined; }
  async readCodexConfig() { return null; }
  async writeCodexConfig() { return true; }
}

const wslInfo = (cwd = '/home/me/proj') =>
  makeInfo({ env: { kind: 'wsl', distro: 'Ubuntu' }, shell: 'bash', cwd: { env: 'wsl', distro: 'Ubuntu', path: cwd as never } });
const winInfo = (cwd = 'C:\\proj') => makeInfo({ cwd: { env: 'windows', path: cwd as never } });

describe('CompletionEngine', () => {
  it('suggests git subcommands and branches, and never anything unrelated', async () => {
    const env = new FakeEnv();
    const { ask } = setup(wslInfo(), env);
    const sub = await ask('git ch');
    expect(sub.items.map((i) => i.label)).toContain('checkout');
    expect(sub.items.find((i) => i.label === 'checkout')!.insertText).toBe('checkout ');
    expect(sub.items.find((i) => i.label === 'checkout')!.replace).toEqual([4, 6]);
    const br = await ask('git checkout fe');
    expect(br.items.map((i) => i.label)).toEqual(['feature/แก้บั๊ก']);
    expect(br.items[0]!.insertText).toBe('feature/แก้บั๊ก ');
    expect((await ask('git checkout -b ne')).items).toEqual([]);
  });

  it('completes commands from PATH and the shell builtins, per environment', async () => {
    const env = new FakeEnv();
    const w = setup(winInfo(), env);
    const ps = await w.ask('Get-Ch');
    expect(ps.items.map((i) => i.label)).toContain('Get-ChildItem');
    expect((await w.ask('nod')).items.map((i) => i.label)).toContain('node');
    const l = setup(wslInfo(), env);
    expect((await l.ask('Get-Ch')).items.map((i) => i.label)).not.toContain('Get-ChildItem');
    expect((await l.ask('ech')).items.map((i) => i.label)).toContain('echo');
  });

  it('completes paths with spaces and quotes them for the shell', async () => {
    const env = new FakeEnv();
    env.files.set('C:\\proj', [
      { name: 'My Documents', isDir: true }, { name: 'main.ts', isDir: false }, { name: '.hidden', isDir: false }, { name: 'งานใหม่', isDir: true }
    ]);
    const { ask } = setup(winInfo(), env);
    const r = await ask('cd M');
    const my = r.items.find((i) => i.label.startsWith('My Documents'))!;
    expect(my.insertText).toBe("'My Documents\\'");
    expect(my.kind).toBe('dir');
    expect(r.items.map((i) => i.label)).not.toContain('.hidden');
    expect((await ask('cd ง')).items[0]!.label).toBe('งานใหม่\\');
    expect((await ask('cd .')).items.map((i) => i.label)).toContain('.hidden');

    const bash = setup(wslInfo('/home/me/p'), env);
    env.files.set('/home/me/p', [{ name: 'my docs', isDir: true }]);
    expect((await bash.ask('cd my')).items[0]!.insertText).toBe('my\\ docs/');
    env.files.set('/home/me/p/my docs', [{ name: 'a b.txt', isDir: false }]);
    const q = await bash.ask('cat "my docs/a');
    expect(q.items[0]!.insertText).toBe('"my docs/a b.txt"');
  });

  it('suggests package scripts after npm run / pnpm', async () => {
    const env = new FakeEnv();
    env.texts.set('C:\\proj\\package.json', JSON.stringify({ scripts: { build: 'vite build', test: 'vitest', 'test:e2e': 'playwright test' } }));
    const { ask } = setup(winInfo(), env);
    const r = await ask('npm run te');
    expect(r.items.map((i) => i.label)).toEqual(['test', 'test:e2e']);
    expect(r.items[0]!.detail).toBe('vitest');
    expect((await ask('pnpm bu')).items.map((i) => i.label)).toContain('build');
    expect((await ask('npm ru')).items.map((i) => i.label)).toContain('run');
  });

  it('ranks history by frecency, keeps environments apart and offers inline ghost text', async () => {
    const env = new FakeEnv();
    const { ask, history } = setup(wslInfo(), env);
    history.record({ envKey: 'wsl:Ubuntu:bash', command: 'git status', at: Date.now() - 1000, cwd: '/home/me/proj' });
    history.record({ envKey: 'wsl:Ubuntu:bash', command: 'git status', at: Date.now() });
    history.record({ envKey: 'wsl:Ubuntu:bash', command: 'git stash list', at: Date.now() - 5000 });
    history.record({ envKey: 'windows:pwsh', command: 'git stash windows-only', at: Date.now() });
    const r = await ask('git sta');
    expect(r.items.filter((i) => i.kind === 'history').map((i) => i.insertText)).toEqual(['git status', 'git stash list']);
    expect(r.ghost).toBe('git status');
    expect(r.items.some((i) => i.insertText.includes('windows-only'))).toBe(false);
  });

  it('stays silent when the shell is busy, for agents, and for blank input', async () => {
    const env = new FakeEnv();
    const busy = setup({ ...wslInfo(), phase: 'executing' }, env);
    expect((await busy.ask('git ch')).items).toEqual([]);
    const agent = setup({ ...wslInfo(), kind: 'agent' }, env);
    expect((await agent.ask('git ch')).items).toEqual([]);
    expect((await setup(wslInfo(), env).ask('   ')).items).toEqual([]);
  });

  it('still answers with the fast providers when one provider is slow', async () => {
    const env = new FakeEnv();
    env.listExecutables = () => new Promise(() => undefined); // never finishes
    const history = new HistoryRepo(openDb(':memory:').db);
    history.record({ envKey: 'windows:pwsh', command: 'git status', at: Date.now() });
    const engine = new CompletionEngine({ sessions: { get: () => winInfo() }, history, env }, 80);
    const t0 = Date.now();
    const r = await engine.query({ requestId: 1, sessionId: 's', line: 'git s', cursor: 5 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.items.map((i) => i.label)).toEqual(expect.arrayContaining(['status']));
  });

  it('never calls anything other than the fixed query operations', async () => {
    const env = new FakeEnv();
    const { ask } = setup(winInfo(), env);
    await ask('rm -rf "; calc.exe" ');
    await ask('cd $(evil)');
    expect(env.calls.every((c) => c.startsWith('ls '))).toBe(true);
  });
});

describe('EnvironmentQueryService on the real file system', () => {
  it('lists directories with spaces and Thai names and finds branches without spawning git', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ad เทส '));
    mkdirSync(join(root, 'sub dir'));
    writeFileSync(join(root, 'ไฟล์.txt'), 'x');
    const svc = new EnvironmentQueryService();
    const list = await svc.listDir({ kind: 'windows' }, root);
    expect(list).toContainEqual({ name: 'sub dir', isDir: true });
    expect(list).toContainEqual({ name: 'ไฟล์.txt', isDir: false });
    mkdirSync(join(root, '.git', 'refs', 'heads', 'feature'), { recursive: true });
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(root, '.git', 'refs', 'heads', 'main'), 'a'.repeat(40));
    writeFileSync(join(root, '.git', 'refs', 'heads', 'feature', 'x'), 'a'.repeat(40));
    writeFileSync(join(root, '.git', 'packed-refs'), `# pack\n${'b'.repeat(40)} refs/heads/old\n${'c'.repeat(40)} refs/remotes/origin/main\n`);
    expect(await windowsGitBranches(join(root, 'sub dir'))).toEqual(['feature/x', 'main', 'old', 'origin/main']);
    expect(await svc.gitBranch({ kind: 'windows' }, join(root, 'sub dir'))).toBe('main');
    expect(await svc.readSmallText({ kind: 'windows' }, join(root, 'ไฟล์.txt'), 100)).toBe('x');
    expect(await svc.readSmallText({ kind: 'windows' }, join(root, 'ไฟล์.txt'), 0)).toBeNull();
  });
});

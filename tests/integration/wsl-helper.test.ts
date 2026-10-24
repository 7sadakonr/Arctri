import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvironmentQueryService } from '../../src/main/env-query/service';
import { WslManager } from '../../src/main/wsl/wsl-manager';

const env = { kind: 'wsl', distro: 'Ubuntu' } as const;
const svc = new EnvironmentQueryService();
const wsl = new WslManager();
const run = (cmd: string) => wsl.exec('Ubuntu', ['bash', '-c', cmd], 20000);
const base = '/tmp/ad-helper-test';

beforeAll(async () => {
  if (process.env['ARCTRI_SKIP_WSL']) return;
  await run(`rm -rf '${base}' && mkdir -p '${base}/my docs/ไทย' '${base}/repo/.git/refs/heads' && echo 'ref: refs/heads/dev-ภาษา' > '${base}/repo/.git/HEAD'`);
  await run(`cd '${base}' && printf x > 'a b.txt' && printf x > 'ไฟล์.txt' && printf x > "quote'd.txt" && printf '{"scripts":{"build":"x"}}' > repo/package.json && mkdir -p 'repo/sub'`);
  await run(`cd '${base}/repo' && git init -q . 2>/dev/null; git -c user.name=a -c user.email=a@b commit -q --allow-empty -m init 2>/dev/null; git branch -q feature/ทดสอบ 2>/dev/null; true`);
});
afterAll(async () => {
  await run(`rm -rf '${base}'`);
  svc.dispose();
});

describe.skipIf(!!process.env['ARCTRI_SKIP_WSL'])('WSL helper (real Ubuntu)', () => {
  it('lists directories with spaces, Thai names and quotes', async () => {
    const list = await svc.listDir(env, base);
    const names = list.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['my docs', 'a b.txt', 'ไฟล์.txt', "quote'd.txt", 'repo']));
    expect(list.find((e) => e.name === 'my docs')!.isDir).toBe(true);
    expect(list.find((e) => e.name === 'a b.txt')!.isDir).toBe(false);
    expect((await svc.listDir(env, `${base}/my docs`)).map((e) => e.name)).toEqual(['ไทย']);
    expect(await svc.listDir(env, `${base}/does not exist`)).toEqual([]);
    expect(await svc.listDirResult(env, `${base}/does not exist`)).toEqual({ ok: false });
  });

  it('gives the watcher a reading of the repository that changes with the branch', async () => {
    const before = await svc.gitSignature(env, `${base}/repo`);
    expect(before).toMatch(/^[^\t]+\t[0-9a-f]{40}\t/);
    expect(await svc.gitSignature(env, `${base}/my docs`)).toBeNull(); // not a repository
    await run(`cd '${base}/repo' && git switch -q feature/ทดสอบ`);
    const after = await svc.gitSignature(env, `${base}/repo`);
    expect(after).not.toBe(before);
    expect(after!.startsWith('feature/ทดสอบ\t')).toBe(true);
    await run(`cd '${base}/repo' && git switch -q -`);
  });

  it('lists folders while the git/PATH lane is busy', async () => {
    await svc.listDir(env, base); // the file lane is up
    const order: string[] = [];
    const slow = svc.helper('Ubuntu', 'slow').request('cmds', [], 10000).then(() => order.push('slow'));
    const list = svc.listDir(env, base).then(() => order.push('list'));
    await Promise.all([slow, list]);
    expect(order[0]).toBe('list');
  });

  it('expands ~ and lists executables from the distro PATH only', async () => {
    expect((await svc.listDir(env, '~')).length).toBeGreaterThan(0);
    const exes = await svc.listExecutables(env);
    expect(exes).toContain('ls');
    expect(exes).toContain('bash');
    expect(exes.some((n) => n.endsWith('.exe'))).toBe(false); // Windows interop PATH entries are skipped
  });

  it('reads small files and the current branch without running anything it was given', async () => {
    expect(await svc.readSmallText(env, `${base}/repo/package.json`, 1000)).toContain('"build"');
    expect(await svc.readSmallText(env, `${base}/repo/package.json`, 3)).toBeNull();
    expect(await svc.gitBranch(env, `${base}/repo/sub`)).toBe('dev-ภาษา');
  });

  it('treats hostile arguments as data', async () => {
    const mark = `${base}/pwned`;
    await svc.listDir(env, `"; touch '${mark}'; echo "`);
    await svc.listDir(env, `$(touch '${mark}')`);
    await svc.listDir(env, "`touch '" + mark + "'`");
    await svc.readSmallText(env, `$(touch '${mark}')`, 100);
    const r = await run(`test -e '${mark}' && echo EXISTS || echo SAFE`);
    expect(r.stdout.trim()).toBe('SAFE');
  });

  it('lists git branches of a repository', async () => {
    const b = await svc.gitBranches(env, `${base}/repo`);
    expect(b.length).toBeGreaterThan(0);
  });

  it('answers within the time limits', async () => {
    const t0 = Date.now();
    await svc.listDir(env, base);
    expect(Date.now() - t0).toBeLessThan(250);
  });
});

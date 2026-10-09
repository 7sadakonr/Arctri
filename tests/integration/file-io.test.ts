import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvironmentQueryService } from '../../src/main/env-query/service';
import { WslManager } from '../../src/main/wsl/wsl-manager';

const skipWsl = !!process.env['ARCTRI_SKIP_WSL'];
const win = { kind: 'windows' } as const;
const wslEnv = { kind: 'wsl', distro: 'Ubuntu' } as const;
const wsl = new WslManager();
const svc = new EnvironmentQueryService();

const root = mkdtempSync(join(tmpdir(), 'ad io ไทย '));
const outside = mkdtempSync(join(tmpdir(), 'ad outside '));
const base = `/tmp/ad-fileio-${Date.now()}`;
const sh = (c: string) => wsl.exec('Ubuntu', ['sh', '-c', c], 30000);

beforeAll(async () => {
  writeFileSync(join(root, 'crlf ไทย.txt'), 'สวัสดี\r\nน้ำ\r\n');
  writeFileSync(join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  try {
    symlinkSync(outside, join(root, 'link-out'), 'junction'); // a folder link that leads out of the root
  } catch {
    /* some systems forbid it; the test below then skips the link assertion */
  }
  if (!skipWsl) {
    await sh(`mkdir -p '${base}/root/sub' '${base}/outside' && printf 'a\\r\\nb\\r\\n' > '${base}/root/crlf ไทย.txt' && printf 'secret' > '${base}/outside/secret.txt' && ln -s '${base}/outside' '${base}/root/link-out' && printf '\\001\\000\\002' > '${base}/root/bin.dat'`);
  }
});
afterAll(async () => {
  svc.dispose();
  if (!skipWsl) await sh(`rm -rf '${base}'`);
});

describe('file read/write on Windows', () => {
  it('reads Thai CRLF text and writes it back as CRLF', async () => {
    const p = join(root, 'crlf ไทย.txt');
    const r = await svc.readTextFile(win, root, p);
    expect(r).toMatchObject({ ok: true, text: 'สวัสดี\nน้ำ\n', eol: 'crlf', bom: false });
    const w = await svc.writeTextFile(win, root, p, 'สวัสดี\nน้ำ\nเพิ่ม\n', 'crlf', false, (r as { mtimeMs: number }).mtimeMs);
    expect(w.ok).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('สวัสดี\r\nน้ำ\r\nเพิ่ม\r\n');
  });

  it('refuses to overwrite a file that changed on disk after it was opened', async () => {
    const p = join(root, 'conflict.txt');
    writeFileSync(p, 'one');
    const r = (await svc.readTextFile(win, root, p)) as { mtimeMs: number };
    await new Promise((res) => setTimeout(res, 30));
    writeFileSync(p, 'changed elsewhere');
    const w = await svc.writeTextFile(win, root, p, 'mine', 'lf', false, r.mtimeMs);
    expect(w).toMatchObject({ ok: false, error: 'conflict' });
    expect(readFileSync(p, 'utf8')).toBe('changed elsewhere');
    // without an expected time (user chose to overwrite) it is written
    expect((await svc.writeTextFile(win, root, p, 'mine', 'lf', false)).ok).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('mine');
  });

  it('refuses binary and oversized files, and creates new files', async () => {
    expect(await svc.readTextFile(win, root, join(root, 'bin.dat'))).toMatchObject({ ok: false, error: 'binary' });
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(5 * 1024 * 1024 + 10));
    expect(await svc.readTextFile(win, root, join(root, 'big.txt'))).toMatchObject({ ok: false, error: 'too-large' });
    expect((await svc.writeTextFile(win, root, join(root, 'new ไฟล์.txt'), 'hi', 'lf', false)).ok).toBe(true);
    expect(await svc.readTextFile(win, root, join(root, 'missing.txt'))).toMatchObject({ ok: false, error: 'not-found' });
  });

  it('never reads or writes outside the folder, even through a link', async () => {
    expect(await svc.readTextFile(win, root, join(outside, 'secret.txt'))).toMatchObject({ ok: false, error: 'denied' });
    expect(await svc.writeTextFile(win, root, join(outside, 'x.txt'), 'x', 'lf', false)).toMatchObject({ ok: false, error: 'denied' });
    const viaLink = await svc.readTextFile(win, root, join(root, 'link-out', 'secret.txt'));
    if (viaLink.ok === false || true) expect(viaLink.ok).toBe(false);
    expect(await svc.statFile(win, root, join(outside, 'secret.txt'))).toBeNull();
  });
});

describe.skipIf(skipWsl)('file read/write in WSL (helper)', () => {
  const r = `${base}/root`;
  it('reads and writes Thai CRLF text, detects conflicts and refuses binary', async () => {
    const p = `${r}/crlf ไทย.txt`;
    const got = await svc.readTextFile(wslEnv, r, p);
    expect(got).toMatchObject({ ok: true, text: 'a\nb\n', eol: 'crlf' });
    const w = await svc.writeTextFile(wslEnv, r, p, 'a\nb\nไทย\n', 'crlf', false, (got as { mtimeMs: number }).mtimeMs);
    expect(w.ok).toBe(true);
    expect((await sh(`od -c '${p}' | head -2`)).stdout).toContain('\\r');
    const stale = await svc.writeTextFile(wslEnv, r, p, 'x', 'lf', false, 1);
    expect(stale).toMatchObject({ ok: false, error: 'conflict' });
    expect(await svc.readTextFile(wslEnv, r, `${r}/bin.dat`)).toMatchObject({ ok: false, error: 'binary' });
    expect(await svc.readTextFile(wslEnv, r, `${r}/nope.txt`)).toMatchObject({ ok: false, error: 'not-found' });
    expect((await svc.writeTextFile(wslEnv, r, `${r}/sub/new file.txt`, 'hello', 'lf', false)).ok).toBe(true);
  });

  it('refuses paths outside the folder, ".." and symlinks that leave it; the helper treats names as data', async () => {
    expect(await svc.readTextFile(wslEnv, r, `${base}/outside/secret.txt`)).toMatchObject({ ok: false, error: 'denied' });
    expect(await svc.readTextFile(wslEnv, r, `${r}/../outside/secret.txt`)).toMatchObject({ ok: false, error: 'denied' });
    expect(await svc.readTextFile(wslEnv, r, `${r}/link-out/secret.txt`)).toMatchObject({ ok: false, error: 'denied' });
    expect(await svc.writeTextFile(wslEnv, r, `${r}/link-out/new.txt`, 'x', 'lf', false)).toMatchObject({ ok: false, error: 'denied' });
    await svc.readTextFile(wslEnv, r, `${r}/$(touch '${base}/pwned')`);
    await svc.writeTextFile(wslEnv, r, `${r}/a'; touch '${base}/pwned2'; '.txt`, 'x', 'lf', false);
    expect((await sh(`ls '${base}' | grep -c pwned || true`)).stdout.trim()).toBe('0');
    expect((await sh(`cat '${base}/outside/secret.txt'`)).stdout).toBe('secret');
  });
});

describe.skipIf(skipWsl)('regressions found by code review (WSL helper)', () => {
  const r = `${base}/root`;
  it('statFile works (empty middle arguments are not collapsed by the shell)', async () => {
    const st = await svc.statFile(wslEnv, r, `${r}/crlf ไทย.txt`);
    expect(st).not.toBeNull();
    expect(st!.size).toBeGreaterThan(0);
    expect(st!.mtimeMs).toBeGreaterThan(1_600_000_000_000);
    expect(st!.mtimeMs).toBeLessThan(4_000_000_000_000);
  });

  it('an empty file can be saved', async () => {
    const p = `${r}/empty.txt`;
    expect((await svc.writeTextFile(wslEnv, r, p, '', 'lf', false)).ok).toBe(true);
    expect((await sh(`wc -c < '${p}'`)).stdout.trim()).toBe('0');
    expect(await svc.readTextFile(wslEnv, r, p)).toMatchObject({ ok: true, text: '' });
  });

  it('fails closed when the root of the tab cannot be resolved', async () => {
    expect(await svc.readTextFile(wslEnv, `${base}/gone-root`, '/etc/hostname')).toMatchObject({ ok: false, error: 'denied' });
    expect(await svc.writeTextFile(wslEnv, `${base}/gone-root`, `${base}/outside/x.txt`, 'x', 'lf', false)).toMatchObject({ ok: false, error: 'denied' });
    expect(await svc.statFile(wslEnv, `${base}/gone-root`, '/etc/hostname')).toBeNull();
  });
});

describe('git paths are relative to the working folder', () => {
  it('Windows: a tab inside a subfolder gets paths it can use, and nothing from outside it', async () => {
    const repo = join(root, 'repo2');
    mkdirSync(join(repo, 'pkg', 'src'), { recursive: true });
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'pipe' });
    git('init', '-q');
    writeFileSync(join(repo, 'top.txt'), 'x\n');
    writeFileSync(join(repo, 'pkg', 'src', 'a.ts'), 'x\n');
    git('add', '.');
    git('commit', '-q', '-m', 'i');
    writeFileSync(join(repo, 'top.txt'), 'x\ny\n');
    writeFileSync(join(repo, 'pkg', 'src', 'a.ts'), 'x\ny\nz\n');
    const c = await svc.gitChanges(win, join(repo, 'pkg'));
    expect(c!.files.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(c!.added).toBe(2);
  });

  it.skipIf(skipWsl)('WSL: the same through the helper', async () => {
    await sh(`mkdir -p '${base}/repo/pkg/src' && cd '${base}/repo' && git init -q . && printf 'x\\n' > top.txt && printf 'x\\n' > pkg/src/a.ts && git add . && git -c user.name=t -c user.email=t@t commit -q -m i && printf 'x\\ny\\n' > top.txt && printf 'x\\ny\\nz\\n' > pkg/src/a.ts && printf 'o' > pkg/new.txt && mkdir -p pkg/build && echo build/ > .gitignore && printf 'b' > pkg/build/x`);
    const c = await svc.gitChanges(wslEnv, `${base}/repo/pkg`);
    expect(c!.files.map((f) => f.path).sort()).toEqual(['new.txt', 'src/a.ts']);
    const all = await svc.gitStatusAll(wslEnv, `${base}/repo/pkg`);
    expect(all!.some((e) => e.status === '!!' && e.path.startsWith('build'))).toBe(true);
  });
});

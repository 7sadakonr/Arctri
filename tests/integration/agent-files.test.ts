import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvironmentQueryService } from '../../src/main/env-query/service';
import { WslManager } from '../../src/main/wsl/wsl-manager';
import { enableTuiNotifications, tuiNotificationsEnabled } from '../../src/main/agents/codex-config';

const skipWsl = !!process.env['ARCTRI_SKIP_WSL'];
const win = { kind: 'windows' } as const;
const wslEnv = { kind: 'wsl', distro: 'Ubuntu' } as const;
const root = mkdtempSync(join(tmpdir(), 'ad files ไทย '));
const codexHomeWin = join(root, 'codex-win');
const wslBase = `/tmp/ad-agent-files-${Date.now()}`;
const wsl = new WslManager();
let svc: EnvironmentQueryService;

beforeAll(async () => {
  // the WSL helper starts with this environment; WSLENV carries the variable into the distro
  process.env['CODEX_HOME'] = codexHomeWin;
  if (!skipWsl) {
    process.env['CODEX_HOME'] = `${wslBase}/codex-home`;
    process.env['WSLENV'] = [process.env['WSLENV'], 'CODEX_HOME'].filter(Boolean).join(':');
    await wsl.exec('Ubuntu', ['sh', '-c', `mkdir -p '${wslBase}/repo/src' '${wslBase}/codex-home' && cd '${wslBase}/repo' && git init -q . && printf 'x\\n' > a.txt && printf 'y\\n' > 'src/ไฟล์ ไทย.ts' && git add . && git -c user.name=t -c user.email=t@t commit -q -m i && printf 'x\\nz\\nw\\n' > a.txt && printf n > 'new one.txt'`], 30000);
  }
  svc = new EnvironmentQueryService();
});
afterAll(async () => {
  svc.dispose();
  if (!skipWsl) await wsl.exec('Ubuntu', ['rm', '-rf', wslBase]);
});

describe('changed files', () => {
  it('Windows: reads status and line counts of a repository with Thai and spaced names', async () => {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'pipe' });
    git('init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    writeFileSync(join(repo, 'src', 'ไฟล์ ไทย.ts'), 'y\n');
    git('add', '.');
    git('commit', '-q', '-m', 'i');
    writeFileSync(join(repo, 'a.txt'), 'x\nz\nw\n');
    writeFileSync(join(repo, 'new one.txt'), 'n');
    const c = await svc.gitChanges(win, repo);
    expect(c).toBeDefined();
    expect(c!.files.map((f) => f.path).sort()).toEqual(['a.txt', 'new one.txt']);
    expect(c!.added).toBe(2);
    expect(await svc.gitChanges(win, root)).toBeUndefined(); // not a repository
  });

  it.skipIf(skipWsl)('WSL: the helper reports the same through its read-only gitstat operation', async () => {
    const c = await svc.gitChanges(wslEnv, `${wslBase}/repo`);
    expect(c).toBeDefined();
    expect(c!.files.map((f) => f.path).sort()).toEqual(['a.txt', 'new one.txt']);
    expect(c!.added).toBe(2);
    expect(await svc.gitChanges(wslEnv, '/tmp')).toBeUndefined();
  });

  it.skipIf(skipWsl)('WSL: hostile folder names stay data', async () => {
    await svc.gitChanges(wslEnv, `$(touch '${wslBase}/pwned')`);
    await svc.gitChanges(wslEnv, `"; touch '${wslBase}/pwned2'; "`);
    const r = await wsl.exec('Ubuntu', ['sh', '-c', `ls '${wslBase}' | grep -c pwned || true`]);
    expect(r.stdout.trim()).toBe('0');
  });
});

describe('Codex configuration', () => {
  it('Windows: reads, edits after a backup and keeps everything else', async () => {
    // the WSL helper (already running) keeps the value it was started with
    process.env['CODEX_HOME'] = codexHomeWin;
    expect(await svc.readCodexConfig(win)).toBeNull(); // no file yet
    mkdirSync(codexHomeWin, { recursive: true });
    writeFileSync(join(codexHomeWin, 'config.toml'), '# mine\nmodel = "m"\n[tui]\ntheme = "t"\n');
    const before = (await svc.readCodexConfig(win))!;
    expect(tuiNotificationsEnabled(before)).toBe(false);
    expect(await svc.writeCodexConfig(win, enableTuiNotifications(before))).toBe(true);
    const after = readFileSync(join(codexHomeWin, 'config.toml'), 'utf8');
    expect(after).toContain('# mine');
    expect(after).toContain('theme = "t"');
    expect(tuiNotificationsEnabled(after)).toBe(true);
    const backups = readdirSync(codexHomeWin).filter((f) => f.startsWith('config.toml.arctri-backup-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(codexHomeWin, backups[0]!), 'utf8')).toBe(before);
  });

  it.skipIf(skipWsl)('WSL: creates the file when missing, then edits it with a backup (only the Codex config path is writable)', async () => {
    expect(await svc.readCodexConfig(wslEnv)).toBeNull();
    expect(await svc.writeCodexConfig(wslEnv, enableTuiNotifications(''))).toBe(true);
    const first = (await svc.readCodexConfig(wslEnv))!;
    expect(tuiNotificationsEnabled(first)).toBe(true);
    const edited = first.replace('notifications = true', 'notifications = false') + '# end ไทย\n';
    expect(await svc.writeCodexConfig(wslEnv, enableTuiNotifications(edited))).toBe(true);
    const second = (await svc.readCodexConfig(wslEnv))!;
    expect(second).toContain('# end ไทย');
    expect(tuiNotificationsEnabled(second)).toBe(true);
    const ls = await wsl.exec('Ubuntu', ['sh', '-c', `ls '${wslBase}/codex-home'`]);
    expect(ls.stdout).toMatch(/config\.toml\.arctri-backup-/);
  });
});

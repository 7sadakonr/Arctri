import { describe, expect, it } from 'vitest';
import type { ShellProfile } from '@shared/types/env';
import { buildShellLaunch, type LaunchContext } from './launch';

const toPosix: LaunchContext['toPosix'] = async (_d, p) => '/mnt/' + p[0]!.toLowerCase() + p.slice(2).replace(/\\/g, '/');
const ctx = (over: Partial<LaunchContext> = {}): LaunchContext => ({ sessionId: 's1', nonce: 'abc123', blocks: true, toPosix, ...over });

const pwsh: ShellProfile = { id: 'pwsh', label: 'PowerShell 7', env: { kind: 'windows' }, shell: 'pwsh', executable: 'C:\\pwsh.exe', integration: 'blocks' };
const cmd: ShellProfile = { ...pwsh, id: 'cmd', shell: 'cmd', executable: 'C:\\cmd.exe', integration: 'cwd-only' };
const bash: ShellProfile = { id: 'wsl:Ubuntu:bash', label: 'x', env: { kind: 'wsl', distro: 'Ubuntu' }, shell: 'bash', executable: 'C:\\wsl.exe', integration: 'blocks' };
const zsh: ShellProfile = { ...bash, id: 'wsl:Ubuntu:zsh', shell: 'zsh' };

describe('buildShellLaunch', () => {
  it('PowerShell: script is passed encoded (no execution policy, no quoting), nonce and mode in env', async () => {
    const p = await buildShellLaunch(pwsh, ctx());
    const args = p.args as string[];
    expect(args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-EncodedCommand']);
    const script = Buffer.from(args[3]!, 'base64').toString('utf16le');
    expect(script).toContain('ARCTRI_NONCE');
    expect(script).toContain('PSConsoleHostReadLine');
    expect(p.env['ARCTRI_NONCE']).toBe('abc123');
    expect(p.env['ARCTRI_BLOCKS']).toBe('1');
    expect(p.env['TERM_PROGRAM']).toBe('Arctri');
    expect((await buildShellLaunch(pwsh, ctx({ blocks: false }))).env['ARCTRI_BLOCKS']).toBe('0');
  });

  it('cmd: only the working folder is reported, through PROMPT', async () => {
    const p = await buildShellLaunch(cmd, ctx());
    expect(p.args).toEqual([]);
    expect(p.env['PROMPT']).toContain('6973;abc123;cwdp;$P');
  });

  it('WSL bash: argv array, rcfile mapped into the distro, env forwarded through WSLENV, no shell string', async () => {
    const p = await buildShellLaunch(bash, ctx({ cwd: { env: 'windows', path: 'D:\\my proj' as never } }));
    expect(p.file).toBe('C:\\wsl.exe');
    const a = p.args as string[];
    expect(a.slice(0, 5)).toEqual(['-d', 'Ubuntu', '--cd', '/mnt/d/my proj', '--exec']);
    expect(a.slice(5, 8)).toEqual(['bash', '--rcfile', expect.stringMatching(/^\/mnt\/.*arctri\.bash$/)]);
    expect(a.at(-1)).toBe('-i');
    for (const k of ['ARCTRI_NONCE', 'ARCTRI_BLOCKS', 'TERM_PROGRAM']) expect(p.env['WSLENV']).toContain(k);
  });

  it('WSL zsh: ZDOTDIR shim, with the user directory preserved', async () => {
    const p = await buildShellLaunch(zsh, ctx());
    const a = p.args as string[];
    expect(a.slice(5, 7)).toEqual(['sh', '-c']);
    expect(a[7]).toContain('USER_ZDOTDIR="${ZDOTDIR:-$HOME}"');
    expect(a[7]).toContain('exec zsh -i');
    expect(a.at(-1)).toMatch(/^\/mnt\/.*\/zsh$/);
    expect(a.slice(2, 5)).toEqual(['--cd', '~', '--exec']);
  });

  it('keeps a WSL folder only for the matching distribution and falls back with a note when mapping fails', async () => {
    const same = await buildShellLaunch(bash, ctx({ cwd: { env: 'wsl', distro: 'Ubuntu', path: '/home/me/ทดสอบ' as never } }));
    expect((same.args as string[])[3]).toBe('/home/me/ทดสอบ');
    const other = await buildShellLaunch(bash, ctx({ cwd: { env: 'wsl', distro: 'Debian', path: '/x' as never } }));
    expect((other.args as string[])[3]).toBe('~');
    const noMap = await buildShellLaunch(bash, ctx({ cwd: { env: 'windows', path: 'Z:\\gone' as never }, toPosix: async (d, p) => (p.endsWith('bash') ? '/mnt/z/rc' : null) }));
    expect(noMap.note).toBe('cwd-unmapped');
  });
});

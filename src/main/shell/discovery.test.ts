import { describe, expect, it } from 'vitest';
import type { WslDistro } from '@shared/types/wsl';
import type { WslManager } from '../wsl/wsl-manager';
import { probeZsh, probeZshAll, wslProfilesFor } from './discovery';

const distro = (state: WslDistro['state'], name = 'Ubuntu'): WslDistro => ({ name, state, version: 2, isDefault: true, hidden: false });
const fakeWsl = (stdout: string) => {
  const calls: string[] = [];
  const wsl = { exec: async (d: string) => (calls.push(d), { code: stdout === 'yes' ? 0 : 1, stdout }) } as unknown as WslManager;
  return { wsl, calls };
};
const memory = (start: Record<string, boolean> = {}) => {
  let v = start;
  return { get: () => v, set: (n: Record<string, boolean>) => (v = n) };
};

describe('wslProfilesFor', () => {
  it('lists one automatic entry per distribution, plus zsh and bash where zsh is installed', () => {
    const ids = wslProfilesFor([distro('Stopped')], 'wsl.exe', { Ubuntu: true }).map((p) => p.id);
    expect(ids).toEqual(['wsl:Ubuntu', 'wsl:Ubuntu:zsh', 'wsl:Ubuntu:bash']);
    expect(wslProfilesFor([distro('Stopped')], 'wsl.exe', {}).map((p) => p.id)).toEqual(['wsl:Ubuntu']);
  });

  it('never offers hidden distributions', () => {
    expect(wslProfilesFor([{ ...distro('Running', 'docker-desktop'), hidden: true }], 'wsl.exe', {})).toEqual([]);
  });
});

describe('probeZsh', () => {
  it('trusts only a clear yes or no', async () => {
    expect(await probeZsh(fakeWsl('yes\n').wsl, 'Ubuntu')).toBe(true);
    expect(await probeZsh(fakeWsl('no\n').wsl, 'Ubuntu')).toBe(false);
    expect(await probeZsh(fakeWsl('').wsl, 'Ubuntu')).toBeUndefined();
  });
});

describe('probeZshAll', () => {
  it('does not remember a probe that failed', async () => {
    const cache = memory();
    await probeZshAll(fakeWsl('').wsl, [distro('Running')], cache);
    expect(cache.get()).toEqual({});
  });

  it('asks a running distribution and keeps the answer', async () => {
    const cache = memory();
    await probeZshAll(fakeWsl('yes').wsl, [distro('Running')], cache);
    expect(cache.get()).toEqual({ Ubuntu: true });
  });

  it('leaves a stopped distribution alone once it is known, and starts it only when it is not', async () => {
    const known = fakeWsl('no');
    await probeZshAll(known.wsl, [distro('Stopped')], memory({ Ubuntu: true }));
    expect(known.calls).toEqual([]);
    const unknown = fakeWsl('yes');
    await probeZshAll(unknown.wsl, [distro('Stopped')], memory());
    expect(unknown.calls).toEqual(['Ubuntu']);
  });
});

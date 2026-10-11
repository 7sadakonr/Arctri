import { describe, expect, it } from 'vitest';
import type { WslDistro, WslStatus } from '@shared/types/wsl';
import type { WslManager } from '../wsl/wsl-manager';
import { ProfileRegistry } from './registry';

const ubuntu: WslDistro = { name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true, hidden: false };

function setup(initial: WslDistro[], answers: Array<{ status: WslStatus; distros: WslDistro[] }>) {
  let calls = 0;
  let next = 0;
  let current = answers[0]!;
  const wsl = {
    status: async () => {
      calls++;
      current = answers[Math.min(next++, answers.length - 1)]!;
      await new Promise((r) => setTimeout(r, 5));
      return current.status;
    },
    listDistros: async () => current.distros,
    exec: async () => ({ code: 0, stdout: 'yes' })
  } as unknown as WslManager;
  let saved = initial;
  const zsh: Record<string, boolean> = {};
  const registry = new ProfileRegistry(wsl, {
    zsh: { get: () => zsh, set: (v) => Object.assign(zsh, v) },
    distros: { get: () => saved, set: (v) => (saved = v) }
  });
  return { registry, calls: () => calls, saved: () => saved };
}
const wslIds = (r: ProfileRegistry) => r.snapshot().profiles.filter((p) => p.env.kind === 'wsl').map((p) => p.id);

describe('ProfileRegistry WSL', () => {
  it('offers the distributions it remembers before WSL has answered', () => {
    const { registry } = setup([ubuntu], [{ status: { available: false, reason: 'error' }, distros: [] }]);
    expect(wslIds(registry)).toEqual(['wsl:Ubuntu']);
  });

  it('keeps them when WSL does not answer', async () => {
    const { registry } = setup([ubuntu], [{ status: { available: false, reason: 'error', detail: 'timeout' }, distros: [] }]);
    await registry.refresh(true);
    expect(wslIds(registry)).toEqual(['wsl:Ubuntu']);
  });

  it('drops them when WSL says there are none, and remembers that', async () => {
    const { registry, saved } = setup([ubuntu], [{ status: { available: false, reason: 'no-distros' }, distros: [] }]);
    await registry.refresh(true);
    expect(wslIds(registry)).toEqual([]);
    expect(saved()).toEqual([]);
  });

  it('shares one probe between callers that ask at the same time', async () => {
    const { registry, calls } = setup([], [{ status: { available: true, defaultDistro: 'Ubuntu' }, distros: [ubuntu] }]);
    await Promise.all([registry.refresh(true), registry.refresh(true), registry.refresh(true)]);
    expect(calls()).toBe(1);
    expect(wslIds(registry)[0]).toBe('wsl:Ubuntu');
  });

  it('still finds a profile by its older id', () => {
    const { registry } = setup([ubuntu], [{ status: { available: false, reason: 'error' }, distros: [] }]);
    expect(registry.get('wsl:Ubuntu:zsh')?.shell).toBe('zsh');
  });
});

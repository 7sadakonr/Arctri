import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildShellStatusEnv } from './shell-env';

const base = () => {
  const root = mkdtempSync(join(tmpdir(), 'arctri-shellenv-'));
  return { nonce: 'n1', eventsDir: join(root, 'e'), settingsPath: join(root, 's.json'), script: '/opt/arctri/hook.sh', toPosix: async (_d: string, p: string) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/mnt/$1') };
};

describe('buildShellStatusEnv', () => {
  it.skipIf(process.platform === 'win32')('local bash/zsh get the variables and a settings file that calls the hook script', async () => {
    const i = base();
    const env = await buildShellStatusEnv({ ...i, env: { kind: 'local' }, shell: 'zsh' });
    expect(env).toMatchObject({ ARCTRI_EVENT_TOKEN: 'n1', ARCTRI_HOOK_SCRIPT: '/opt/arctri/hook.sh', ARCTRI_EVENTS_DIR: i.eventsDir });
    expect(JSON.parse(readFileSync(i.settingsPath, 'utf8')).hooks.Stop[0].hooks[0].command).toBe("sh '/opt/arctri/hook.sh' claude");
  });
  it('WSL paths are translated into the distro', async () => {
    const i = base();
    const env = await buildShellStatusEnv({ ...i, env: { kind: 'wsl', distro: 'Ubuntu' }, shell: 'bash' });
    expect(env?.['ARCTRI_EVENTS_DIR']).toBe(await i.toPosix('Ubuntu', i.eventsDir));
    expect(env?.['ARCTRI_EVENTS_DIR']).toMatch(/^\/[\w/.-]+$/);
  });
  it('is not offered for Windows shells, other shells or unusable paths', async () => {
    const i = base();
    expect(await buildShellStatusEnv({ ...i, env: { kind: 'windows' }, shell: 'bash' })).toBeNull();
    expect(await buildShellStatusEnv({ ...i, env: { kind: 'local' }, shell: 'fish' })).toBeNull();
    expect(await buildShellStatusEnv({ ...i, env: { kind: 'local' }, shell: 'bash', script: "/x/';rm;'" })).toBeNull();
    expect(existsSync(i.settingsPath)).toBe(false);
  });
});

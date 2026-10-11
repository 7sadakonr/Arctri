import { describe, expect, it } from 'vitest';
import type { ShellProfile } from '@shared/types/env';
import { bashHasBlocks, defaultLocalProfileId, discoverLocalProfiles, localCwd } from './local';
import { buildShellLaunch } from './launch';

const present = (...paths: string[]) => (p: string) => paths.includes(p);

describe('shells on a Mac', () => {
  it('finds zsh and the system bash, and bash 3.2 gets no command blocks', () => {
    const profiles = discoverLocalProfiles(present('/bin/zsh', '/bin/bash'), () => [3, 2], '/bin/zsh');
    expect(profiles.map((p) => [p.id, p.integration])).toEqual([
      ['local:zsh', 'blocks'],
      ['local:bash', 'cwd-only']
    ]);
    expect(profiles.every((p) => p.env.kind === 'local')).toBe(true);
  });

  it('gives a Homebrew bash command blocks (4.4 or newer)', () => {
    const profiles = discoverLocalProfiles(present('/bin/zsh', '/opt/homebrew/bin/bash'), () => [5, 2], '/bin/zsh');
    expect(profiles.find((p) => p.id === 'local:bash-homebrew')).toMatchObject({ shell: 'bash', integration: 'blocks', label: 'bash (Homebrew)' });
    expect(bashHasBlocks([4, 3])).toBe(false);
    expect(bashHasBlocks([4, 4])).toBe(true);
    expect(bashHasBlocks(undefined)).toBe(false);
  });

  it('chooses a default and has nothing to offer when no shell is found', () => {
    const profiles = discoverLocalProfiles(present('/bin/zsh', '/bin/bash'), () => [3, 2], '/bin/bash');
    // the login shell is listed first and is the default, whatever machine the test runs on
    expect(profiles[0]?.id).toBe('local:bash');
    expect(defaultLocalProfileId(profiles, '/bin/bash')).toBe('local:bash');
    expect(defaultLocalProfileId(profiles, '/usr/bin/fish')).toBe('local:bash'); // unknown login shell: the first one
    expect(discoverLocalProfiles(present(), () => undefined, '/bin/zsh')).toEqual([]);
  });

  it('starts in the folder it is given, else in the home folder', () => {
    expect(localCwd({ env: 'local', path: '/Users/me/app' as never })).toBe('/Users/me/app');
    expect(localCwd({ env: 'windows', path: 'C:\\x' as never })).not.toBe('C:\\x');
    expect(localCwd(undefined)).toBeTruthy();
  });
});

describe('launching a local shell', () => {
  const ctx = { sessionId: 's', nonce: 'n', blocks: true, toPosix: async () => null };
  const profile = (shell: 'zsh' | 'bash'): ShellProfile => ({
    id: `local:${shell}`, label: shell, env: { kind: 'local' }, shell, executable: `/bin/${shell}`, integration: 'blocks'
  });

  it('starts zsh as a login shell with the integration handed over by ZDOTDIR', async () => {
    const plan = await buildShellLaunch(profile('zsh'), { ...ctx, cwd: { env: 'local', path: '/Users/me/app' as never } });
    expect(plan.file).toBe('/bin/zsh');
    expect(plan.args).toEqual(['-l', '-i']);
    expect(plan.cwd).toBe('/Users/me/app');
    expect(plan.env['ZDOTDIR']).toMatch(/shell-integration[\\/]zsh$/);
    expect(plan.env['USER_ZDOTDIR']).toBeTruthy();
    expect(plan.env['LANG'] ?? plan.env['LC_ALL']).toBeTruthy();
  });

  it('starts bash with the integration script as its rc file', async () => {
    const plan = await buildShellLaunch(profile('bash'), ctx);
    expect(plan.file).toBe('/bin/bash');
    expect(plan.args).toEqual(['--rcfile', expect.stringMatching(/arctri\.bash$/), '-i']);
  });
});

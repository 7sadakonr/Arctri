import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import type { EnvPath, ShellProfile } from '@shared/types/env';

/** The user's login shell: what the system says, then $SHELL, then zsh (the macOS default). */
export function userShell(): string {
  let fromSystem = '';
  try {
    fromSystem = userInfo().shell ?? '';
  } catch {
    /* no passwd entry */
  }
  for (const s of [fromSystem, process.env['SHELL'] ?? '']) if (s && existsSync(s)) return s;
  return '/bin/zsh';
}

/** Working folder for a shell on this machine: the requested one when it is local, else the home folder. */
export function localCwd(cwd: EnvPath | undefined): string {
  return cwd && cwd.env === 'local' ? cwd.path : homedir();
}

/** The version number of a bash, as `[major, minor]`; the bash that macOS ships is 3.2. */
function bashVersion(path: string): [number, number] | undefined {
  try {
    const out = execFileSync(path, ['-c', 'echo "${BASH_VERSINFO[0]} ${BASH_VERSINFO[1]}"'], { timeout: 3000, encoding: 'utf8' });
    const [a, b] = out.trim().split(/\s+/).map(Number);
    return Number.isInteger(a) && Number.isInteger(b) ? [a as number, b as number] : undefined;
  } catch {
    return undefined;
  }
}

/** Command blocks need bash 4.4 or newer (the integration uses PS0). */
export const bashHasBlocks = (v: [number, number] | undefined): boolean => !!v && (v[0] > 4 || (v[0] === 4 && v[1] >= 4));

/** Shells found on a Mac (or any non-Windows host), in the order they are listed; the login shell is listed first. */
export function discoverLocalProfiles(
  exists: (p: string) => boolean = existsSync,
  versionOf = bashVersion,
  login: string = userShell()
): ShellProfile[] {
  const env = { kind: 'local' } as const;
  const out: ShellProfile[] = [];
  const add = (id: string, label: string, shell: 'zsh' | 'bash', executable: string, blocks: boolean) =>
    out.push({ id, label, env, shell, executable, integration: blocks ? 'blocks' : 'cwd-only' });
  if (exists('/bin/zsh')) add('local:zsh', 'zsh', 'zsh', '/bin/zsh', true);
  for (const [id, path] of [
    ['local:bash', '/bin/bash'],
    ['local:bash-homebrew', '/opt/homebrew/bin/bash'],
    ['local:bash-homebrew-intel', '/usr/local/bin/bash']
  ] as const) {
    if (!exists(path)) continue;
    const label = id === 'local:bash' ? 'bash' : 'bash (Homebrew)';
    add(id, label, 'bash', path, bashHasBlocks(versionOf(path)));
  }
  const first = out.findIndex((p) => p.executable === login);
  if (first > 0) out.unshift(...out.splice(first, 1));
  return out;
}

/** The profile that matches the user's login shell: the default for a new tab. */
export function defaultLocalProfileId(profiles: ShellProfile[], login: string = userShell()): string | undefined {
  return (profiles.find((p) => p.executable === login) ?? profiles[0])?.id;
}

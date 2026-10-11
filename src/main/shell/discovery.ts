import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ShellProfile } from '@shared/types/env';
import type { WslDistro } from '@shared/types/wsl';
import type { WslManager } from '../wsl/wsl-manager';

const winExists = (p: string | undefined): p is string => !!p && existsSync(p);

function findPwsh(): string | undefined {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const candidates = [join(pf, 'PowerShell', '7', 'pwsh.exe'), join(pf, 'PowerShell', '7-preview', 'pwsh.exe')];
  for (const dir of (process.env['PATH'] ?? '').split(';')) {
    if (dir) candidates.push(join(dir, 'pwsh.exe'));
  }
  return candidates.find((c) => existsSync(c));
}

export function discoverWindowsProfiles(): ShellProfile[] {
  const sys = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32');
  const profiles: ShellProfile[] = [];
  const pwsh = findPwsh();
  if (winExists(pwsh)) {
    profiles.push({
      id: 'pwsh', label: 'PowerShell 7', env: { kind: 'windows' }, shell: 'pwsh',
      executable: pwsh, integration: 'blocks'
    });
  }
  const ps5 = join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (existsSync(ps5)) {
    profiles.push({
      id: 'powershell', label: 'Windows PowerShell', env: { kind: 'windows' }, shell: 'powershell',
      executable: ps5, integration: 'blocks'
    });
  }
  const cmd = process.env['ComSpec'] ?? join(sys, 'cmd.exe');
  if (existsSync(cmd)) {
    profiles.push({
      id: 'cmd', label: 'Command Prompt', env: { kind: 'windows' }, shell: 'cmd',
      executable: cmd, integration: 'cwd-only'
    });
  }
  return profiles;
}

/** What is known about zsh per distribution, kept between runs so a stopped distribution never has to be started to find out. */
export interface ZshCache {
  get(): Record<string, boolean>;
  set(value: Record<string, boolean>): void;
}

/** One automatic entry per distribution, plus explicit zsh and bash entries where zsh is known to be installed. */
export function wslProfilesFor(distros: WslDistro[], wslExe: string, zsh: Record<string, boolean>): ShellProfile[] {
  const out: ShellProfile[] = [];
  for (const d of distros) {
    if (d.hidden) continue;
    const base = { env: { kind: 'wsl', distro: d.name } as const, executable: wslExe, integration: 'blocks' as const };
    // The shell of the automatic entry is chosen when it starts (see buildShellLaunch).
    out.push({ ...base, id: `wsl:${d.name}`, label: d.name, shell: 'bash', autoShell: true });
    if (zsh[d.name]) {
      out.push({ ...base, id: `wsl:${d.name}:zsh`, label: `${d.name} · zsh`, shell: 'zsh' });
      out.push({ ...base, id: `wsl:${d.name}:bash`, label: `${d.name} · bash`, shell: 'bash' });
    }
  }
  return out;
}

/** undefined when the answer is unclear (timeout, WSL busy): a failed probe must never be taken for "no zsh". */
export async function probeZsh(wsl: WslManager, distro: string): Promise<boolean | undefined> {
  const r = await wsl.exec(distro, ['sh', '-c', 'command -v zsh >/dev/null 2>&1 && echo yes || echo no'], 20000);
  const out = r.stdout.trim();
  return out === 'yes' ? true : out === 'no' ? false : undefined;
}

/** A running distribution is asked again; a stopped one is only started when nothing is known about it yet. */
export async function probeZshAll(wsl: WslManager, distros: WslDistro[], cache: ZshCache): Promise<void> {
  const known = { ...cache.get() };
  for (const d of distros) {
    if (d.hidden || (d.state !== 'Running' && known[d.name] !== undefined)) continue;
    const found = await probeZsh(wsl, d.name);
    if (found === undefined) continue;
    known[d.name] = found;
    cache.set({ ...known });
  }
}

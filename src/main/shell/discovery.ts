import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ShellProfile } from '@shared/types/env';
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

export async function discoverWslProfiles(wsl: WslManager, wslExe: string): Promise<ShellProfile[]> {
  const distros = await wsl.listDistros(true);
  const out: ShellProfile[] = [];
  for (const d of distros) {
    const base = { env: { kind: 'wsl', distro: d.name } as const, executable: wslExe, integration: 'blocks' as const };
    out.push({ ...base, id: `wsl:${d.name}:bash`, label: `${d.name} · bash`, shell: 'bash' });
    // zsh is probed only on running distributions so discovery never boots a stopped one.
    if (d.state === 'Running') {
      const z = await wsl.exec(d.name, ['sh', '-c', 'command -v zsh >/dev/null 2>&1'], 5000);
      if (z.code === 0) out.push({ ...base, id: `wsl:${d.name}:zsh`, label: `${d.name} · zsh`, shell: 'zsh' });
    }
  }
  return out;
}

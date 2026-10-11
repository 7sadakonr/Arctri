import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, extname, join } from 'node:path';
import type { WslManager } from '../wsl/wsl-manager';

const EXT_ORDER = ['.exe', '.com', '.cmd', '.bat'];

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Looks the command up on a Windows PATH. A native .exe wins over an npm .cmd shim. */
export function findOnWindowsPath(command: string, pathEnv: string, override?: string): string | undefined {
  if (override) return isFile(override) ? override : undefined;
  const dirs = pathEnv.split(';').filter(Boolean);
  for (const ext of EXT_ORDER) {
    for (const dir of dirs) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate) && isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

export const isCmdShim = (path: string): boolean => ['.cmd', '.bat'].includes(extname(path).toLowerCase());

function run(file: string, args: string[], timeoutMs: number, verbatim = false): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: verbatim, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        resolve({ code, out: `${stdout}\n${stderr}` });
      }
    );
  });
}

/** Runs an installed Windows agent non-interactively (version and help probes only). */
export function probeWindows(path: string, args: string[], timeoutMs = 8000) {
  if (isCmdShim(path)) {
    const comspec = process.env['ComSpec'] ?? 'C:\\Windows\\System32\\cmd.exe';
    return run(comspec, ['/d', '/s', '/c', `"${path}" ${args.join(' ')}`], timeoutMs, true);
  }
  return run(path, args, timeoutMs);
}

export const parseVersion = (out: string): string | undefined => /(\d+\.\d+\.\d+(?:[-+.][\w.]+)?)/.exec(out)?.[1];

/**
 * Finds a command inside a distribution. A login shell is tried first, then an interactive one,
 * because tools installed through nvm or ~/.local/bin are often set up in ~/.bashrc only.
 */
export async function findInWsl(
  wsl: WslManager, distro: string, command: string, override?: string
): Promise<{ path: string; source: 'path' | 'login-shell' } | undefined> {
  if (override) {
    const r = await wsl.exec(distro, ['sh', '-c', 'test -x "$1" && printf %s "$1"', 'sh', override], 8000);
    return r.code === 0 && r.stdout.trim() ? { path: override, source: 'path' } : undefined;
  }
  const attempt = async (flags: string): Promise<string | undefined> => {
    const r = await wsl.exec(distro, ['bash', flags, 'command -v "$0"', command], 15000);
    const line = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('/')).pop();
    return r.code === 0 ? line : undefined;
  };
  const login = await attempt('-lc');
  if (login) return { path: login, source: 'path' };
  const inter = await attempt('-lic');
  return inter ? { path: inter, source: 'login-shell' } : undefined;
}

/** `--version` and `--help` of an agent inside WSL, run the way the agent will be launched. */
export async function probeWsl(wsl: WslManager, distro: string, command: string, args: string[], timeoutMs = 15000) {
  const r = await wsl.exec(distro, ['bash', '-lic', 'exec "$0" "$@"', command, ...args], timeoutMs);
  return { code: r.code, out: r.stdout };
}

const isExecutable = (p: string): boolean => {
  try {
    accessSync(p, constants.X_OK);
    return isFile(p);
  } catch {
    return false;
  }
};

/** Where tools installed by npm, Homebrew, bun or the vendors' own installers usually end up on a Mac. */
const wellKnownDirs = (): string[] => {
  const h = homedir();
  return [
    join(h, '.local', 'bin'), join(h, '.claude', 'local'), join(h, '.bun', 'bin'), join(h, '.npm-global', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin'
  ];
};

/**
 * Finds a command on this machine (macOS). An app started from Finder has a minimal PATH, so the usual install folders
 * are looked at too, and last the user's login shell is asked, because tools from nvm are set up in its startup files.
 */
export async function findLocal(
  command: string, shell: string, pathEnv: string, override?: string
): Promise<{ path: string; source: 'path' | 'login-shell' } | undefined> {
  if (override) return isExecutable(override) ? { path: override, source: 'path' } : undefined;
  for (const dir of [...pathEnv.split(delimiter).filter(Boolean), ...wellKnownDirs()]) {
    const candidate = join(dir, command);
    if (isExecutable(candidate)) return { path: candidate, source: 'path' };
  }
  const r = await run(shell, ['-lic', 'command -v "$0"', command], 15000);
  const line = r.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('/')).pop();
  return r.code === 0 && line && isExecutable(line) ? { path: line, source: 'login-shell' } : undefined;
}

/** `--version` and `--help` of an agent, run the way the agent will be launched: through a login shell, so `node` is found. */
export const probeLocal = (shell: string, command: string, args: string[], timeoutMs = 15000) =>
  run(shell, ['-lic', 'exec "$0" "$@"', command, ...args], timeoutMs);

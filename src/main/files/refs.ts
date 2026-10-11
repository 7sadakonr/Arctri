import { posix, win32 } from 'node:path';

type Lib = typeof posix;

/** Resolves `rel` below `root`; undefined when it would escape the root (the file panel must not leave the folder). */
export function resolveWithin(root: string, rel: string, kind: 'windows' | 'wsl' | 'local'): string | undefined {
  const lib: Lib = kind === 'windows' ? win32 : posix;
  const abs = lib.resolve(root, rel);
  const r = lib.relative(root, abs);
  if (r === '..' || r.startsWith('..' + lib.sep) || lib.isAbsolute(r)) return undefined;
  return abs;
}

/** `\\wsl.localhost\Ubuntu\home\me\x` or `\\wsl$\Ubuntu\...` -> `/home/me/x` (only for the given distribution). */
export function uncToPosix(unc: string, distro: string): string | undefined {
  const m = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i.exec(unc);
  if (!m || m[1]!.toLowerCase() !== distro.toLowerCase()) return undefined;
  return (m[2] ?? '\\').replace(/\\/g, '/');
}

const needsQuotes = (p: string) => /[\s"'`$()&;|<>]/.test(p);

/**
 * How a file is written in a message to an agent: `@relative/path` inside the working folder, `@/absolute/path`
 * outside it, quoted when it contains spaces. No Enter is ever added.
 */
export function formatRef(cwd: string, abs: string, kind: 'windows' | 'wsl' | 'local'): string {
  const lib: Lib = kind === 'windows' ? win32 : posix;
  const rel = lib.relative(cwd, abs);
  const inside = !!rel && rel !== '..' && !rel.startsWith('..' + lib.sep) && !lib.isAbsolute(rel);
  const shown = (inside ? rel : abs).replace(/\\/g, kind === 'windows' ? '\\' : '/');
  return needsQuotes(shown) ? `@"${shown.replace(/"/g, '\\"')}"` : `@${shown}`;
}

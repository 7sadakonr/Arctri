import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EnvironmentRef } from '@shared/types/env';

const IMAGE_FILE = (n: number) => new RegExp(`^${n}\\.(png|jpe?g|gif|webp|bmp)$`, 'i');
const CLAUDE_TEMP = /^claude(-\d+)?$/;

/** The folder name Claude Code gives a project: the path with everything but letters and digits turned into "-". */
export const projectKey = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/**
 * Folders (as this machine sees them) in which Claude Code keeps its temporary files for a tab's environment. For a WSL tab they
 * are read through the \\wsl.localhost share, so nothing has to run inside the distribution.
 */
export function tempRoots(env: EnvironmentRef, vars: NodeJS.ProcessEnv = process.env): string[] {
  const own = vars['CLAUDE_CODE_TMPDIR'];
  if (env.kind === 'wsl') return [`\\\\wsl.localhost\\${env.distro}\\tmp`];
  return [own, ...(process.platform === 'win32' ? [vars['TEMP'], vars['TMP']] : ['/tmp', '/private/tmp', vars['TMPDIR']]), tmpdir()].filter(
    (r): r is string => !!r
  );
}

const dirs = async (parent: string): Promise<string[]> => {
  try {
    return (await readdir(parent, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
};

/**
 * The file in which Claude Code saved pasted image number `n` (`[Image #n]`): `<temp>/claude-<uid>/<project>/<session>/images/<n>.<ext>`.
 * With the session id it is looked up directly; without it the newest session of the tab's project that has such a file is taken.
 */
export async function findPastedImage(roots: string[], cwd: string, sessionId: string | undefined, n: number): Promise<string | undefined> {
  const want = IMAGE_FILE(n);
  const key = projectKey(cwd);
  const found: Array<{ file: string; mtimeMs: number }> = [];
  for (const root of roots) {
    for (const top of (await dirs(root)).filter((d) => CLAUDE_TEMP.test(d))) {
      const projects = await dirs(join(root, top));
      for (const project of projects.filter((p) => !sessionId && p === key).concat(sessionId ? projects : [])) {
        for (const session of sessionId ? [sessionId] : await dirs(join(root, top, project))) {
          const images = join(root, top, project, session, 'images');
          let names: string[];
          try {
            names = await readdir(images);
          } catch {
            continue;
          }
          const name = names.find((f) => want.test(f));
          if (!name) continue;
          const file = join(images, name);
          const st = await stat(file).catch(() => null);
          if (st) found.push({ file, mtimeMs: st.mtimeMs });
        }
      }
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.file;
}

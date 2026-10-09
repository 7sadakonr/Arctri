import { readFileSync, statSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

/** Reads the branch from .git/HEAD; never spawns git. Returns a short sha when detached. */
export function gitBranchOf(cwd: string): string | undefined {
  let dir = cwd;
  for (let i = 0; i < 40; i++) {
    const dotGit = join(dir, '.git');
    try {
      const st = statSync(dotGit);
      let headPath = join(dotGit, 'HEAD');
      if (st.isFile()) {
        const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
        if (!m) return undefined;
        headPath = join(join(dir, m[1]!.trim()), 'HEAD');
      }
      const head = readFileSync(headPath, 'utf8').trim();
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      return ref ? ref[1] : head.slice(0, 7);
    } catch {
      /* not here */
    }
    const parent = dirname(dir);
    if (parent === dir || dir === parse(dir).root) return undefined;
    dir = parent;
  }
  return undefined;
}

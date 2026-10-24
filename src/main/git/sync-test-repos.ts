import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

export function commitFile(dir: string, name: string, text: string): void {
  writeFileSync(join(dir, name), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `edit ${name}`);
}

/** A bare "server" with one commit on main and two clones of it, `a` and `b`, each tracking origin/main. */
export function makeRemote(): { root: string; remote: string; a: string; b: string } {
  const root = mkdtempSync(join(tmpdir(), 'arctri-sync-'));
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const a = join(root, 'a');
  execFileSync('git', ['clone', '-q', remote, a], { stdio: 'pipe' });
  commitFile(a, 'one.txt', '1\n');
  git(a, 'branch', '-M', 'main');
  git(a, 'push', '-q', '-u', 'origin', 'main');
  const b = join(root, 'b');
  execFileSync('git', ['clone', '-q', remote, b], { stdio: 'pipe' });
  return { root, remote, a, b };
}

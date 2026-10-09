import { execFile } from 'node:child_process';

export interface ChangedFile {
  path: string;
  /** Two-letter porcelain status, e.g. ' M', '??', 'A '. */
  status: string;
  added: number;
  deleted: number;
}

export interface Changes {
  files: ChangedFile[];
  added: number;
  deleted: number;
}

const unquote = (p: string): string => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : p);

/** `git status --porcelain=v1` (not -z), with core.quotepath=off so Thai names are not escaped. */
export function parseStatus(text: string): Array<{ path: string; status: string }> {
  const out: Array<{ path: string; status: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    let path = line.slice(3);
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4); // rename: the new name
    out.push({ path: unquote(path), status });
  }
  return out;
}

/** `git diff --numstat HEAD`: "added<TAB>deleted<TAB>path", binary files show "-". */
export function parseNumstat(text: string): Map<string, { added: number; deleted: number }> {
  const m = new Map<string, { added: number; deleted: number }>();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const a = parts[0] === '-' ? 0 : Number(parts[0]);
    const d = parts[1] === '-' ? 0 : Number(parts[1]);
    let path = parts.slice(2).join('\t');
    const brace = /^(.*)\{.* => (.*)\}(.*)$/.exec(path);
    if (brace) path = (brace[1]! + brace[2]! + brace[3]!).replace('//', '/');
    else if (path.includes(' => ')) path = path.split(' => ')[1]!;
    if (Number.isFinite(a) && Number.isFinite(d)) m.set(unquote(path), { added: a, deleted: d });
  }
  return m;
}

export function combineChanges(status: string, numstat: string): Changes {
  const stats = parseNumstat(numstat);
  const files = parseStatus(status).map((f) => ({ ...f, ...(stats.get(f.path) ?? { added: 0, deleted: 0 }) }));
  return {
    files,
    added: files.reduce((n, f) => n + f.added, 0),
    deleted: files.reduce((n, f) => n + f.deleted, 0)
  };
}

/** Section format produced by the WSL helper's `gitstat` operation. */
export function parseHelperGitStat(text: string): Changes | undefined {
  if (!text.includes('##STATUS')) return undefined;
  const [, rest = ''] = text.split('##STATUS\n');
  const [status = '', numstat = ''] = rest.split('##NUMSTAT\n');
  return combineChanges(status, numstat);
}

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', '--no-optional-locks', ...args],
      { cwd, timeout: 2500, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout)
    );
  });
}

/** Changed files of the repository at `cwd` on Windows; undefined when it is not a git repository. */
export async function windowsGitChanges(cwd: string): Promise<Changes | undefined> {
  const status = await git(cwd, ['status', '--porcelain=v1']);
  if (status === null) return undefined;
  const numstat = (await git(cwd, ['diff', '--numstat', 'HEAD'])) ?? '';
  return combineChanges(status, numstat);
}

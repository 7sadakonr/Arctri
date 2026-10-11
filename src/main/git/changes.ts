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

/**
 * `git status -s` (paths relative to the working folder, unlike --porcelain which is relative to the repository root),
 * with core.quotepath=off so Thai names are not escaped. Entries outside the working folder ("../x") are dropped.
 */
export function parseStatus(text: string): Array<{ path: string; status: string }> {
  const out: Array<{ path: string; status: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    let path = line.slice(3);
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4); // rename: the new name
    const clean = unquote(path);
    if (clean.startsWith('../')) continue;
    out.push({ path: clean, status });
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
  // the helper's output went through $(...), which drops trailing newlines: "##NUMSTAT" may end the text
  const [, rest = ''] = text.split(/##STATUS\n?/);
  const [status = '', numstat = ''] = rest.split(/\n?##NUMSTAT\n?/);
  return combineChanges(status, numstat);
}

/** status and diff walk the whole working tree; on a big repository that takes a while. */
const SLOW_MS = 12_000;

function git(cwd: string, args: string[], timeout = 2500): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', '--no-optional-locks', ...args],
      { cwd, timeout, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout)
    );
  });
}

/** The file as committed in HEAD (`rel` is relative to `cwd`); null when it is not tracked or `cwd` is not a repository. */
export function windowsGitHeadText(cwd: string, rel: string): Promise<string | null> {
  return git(cwd, ['show', `HEAD:./${rel.replace(/\\/g, '/')}`]);
}

/** Every status below `cwd` including ignored paths ("!!"); used to colour the file tree. */
export async function windowsGitStatusAll(cwd: string): Promise<Array<{ path: string; status: string }> | undefined> {
  const out = await git(cwd, ['status', '-s', '--ignored=matching'], SLOW_MS);
  return out === null ? undefined : parseStatus(out);
}

/** Changed files of the repository at `cwd` on Windows; undefined when it is not a git repository. */
export async function windowsGitChanges(cwd: string): Promise<Changes | undefined> {
  const status = await git(cwd, ['status', '-s'], SLOW_MS);
  if (status === null) return undefined;
  const numstat = (await git(cwd, ['diff', '--relative', '--numstat', 'HEAD'], SLOW_MS)) ?? '';
  return combineChanges(status, numstat);
}

// ---- branches, history -------------------------------------------------------------------------------------------

export interface BranchInfo {
  name: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
}
export interface Refs {
  current?: string;
  local: BranchInfo[];
  remote: BranchInfo[];
}

/** `%(refname)<TAB>%(HEAD)<TAB>%(upstream:short)<TAB>%(upstream:track,nobracket)` per line, as asked of `git for-each-ref`. */
export function parseRefs(text: string): Refs {
  const out: Refs = { local: [], remote: [] };
  for (const line of text.split('\n')) {
    const [ref = '', head = '', upstream = '', track = ''] = line.split('\t');
    if (!ref) continue;
    const info: BranchInfo = { name: '' };
    if (upstream) info.upstream = upstream;
    const ahead = /ahead (\d+)/.exec(track);
    const behind = /behind (\d+)/.exec(track);
    if (ahead) info.ahead = Number(ahead[1]);
    if (behind) info.behind = Number(behind[1]);
    if (ref.startsWith('refs/heads/')) {
      info.name = ref.slice('refs/heads/'.length);
      out.local.push(info);
      if (head.trim() === '*') out.current = info.name;
    } else if (ref.startsWith('refs/remotes/')) {
      info.name = ref.slice('refs/remotes/'.length);
      if (info.name.endsWith('/HEAD')) continue;
      out.remote.push(info);
    }
  }
  return out;
}

export interface Commit {
  hash: string;
  short: string;
  author: string;
  /** Seconds since the epoch. */
  time: number;
  refs: string[];
  subject: string;
}

/** `%H<TAB>%h<TAB>%an<TAB>%at<TAB>%D<TAB>%s` per line. */
export function parseLog(text: string): Commit[] {
  const out: Commit[] = [];
  for (const line of text.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 6 || !/^[0-9a-f]{7,40}$/.test(parts[0]!)) continue;
    const [hash, short, author, time, refs, ...subject] = parts as [string, string, string, string, string, ...string[]];
    out.push({
      hash, short, author, time: Number(time) || 0,
      refs: refs ? refs.split(', ').map((r) => r.replace(/^HEAD -> /, '')).filter((r) => r && r !== 'HEAD') : [],
      subject: subject.join('\t')
    });
  }
  return out;
}

export interface CommitFile {
  path: string;
  /** M, A, D, R or C (renames and copies keep their first letter only). */
  status: string;
  added: number;
  deleted: number;
}

/** The new name of a rename as `git --numstat` prints it ("a/{b => c}/d" or "old => new"). */
function renamedTo(p: string): string {
  if (p.includes('{')) return p.replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/\/\//g, '/');
  const i = p.indexOf(' => ');
  return i < 0 ? p : p.slice(i + 4);
}

/** Files a commit changed: `--name-status` and `--numstat` output of `git show --format=`. */
export function parseCommitFiles(nameStatus: string, numstat: string): CommitFile[] {
  const counts = new Map<string, { added: number; deleted: number }>();
  for (const line of numstat.split('\n')) {
    const [a, d, ...rest] = line.split('\t');
    if (!rest.length) continue;
    counts.set(renamedTo(rest.join('\t')), { added: a === '-' ? 0 : Number(a) || 0, deleted: d === '-' ? 0 : Number(d) || 0 });
  }
  const files: CommitFile[] = [];
  for (const line of nameStatus.split('\n')) {
    const [st, ...paths] = line.split('\t');
    if (!st || !paths.length) continue;
    const path = paths[paths.length - 1]!;
    files.push({ path, status: st[0]!, ...(counts.get(path) ?? { added: 0, deleted: 0 }) });
  }
  return files;
}

/** Section format produced by the WSL helper's `gitshow` operation. */
export function parseHelperGitShow(text: string): CommitFile[] | undefined {
  if (!text.includes('##STATUS')) return undefined;
  const [, rest = ''] = text.split(/##STATUS\n?/);
  const [status = '', numstat = ''] = rest.split(/\n?##NUMSTAT\n?/);
  return parseCommitFiles(status, numstat);
}

const FIELDS = '%H%x09%h%x09%an%x09%at%x09%D%x09%s';
const REFS_FORMAT = '%(refname)%09%(HEAD)%09%(upstream:short)%09%(upstream:track,nobracket)';

export async function windowsGitRefs(cwd: string): Promise<Refs | undefined> {
  if ((await git(cwd, ['rev-parse', '--is-inside-work-tree'])) === null) return undefined;
  const out = await git(cwd, ['for-each-ref', `--format=${REFS_FORMAT}`, 'refs/heads', 'refs/remotes']);
  return out === null ? undefined : parseRefs(out);
}

export async function windowsGitLog(cwd: string, limit: number): Promise<Commit[] | undefined> {
  if ((await git(cwd, ['rev-parse', '--is-inside-work-tree'])) === null) return undefined;
  // a repository without commits has no log: that is an empty history, not an error
  return parseLog((await git(cwd, ['log', '-n', String(limit), `--format=${FIELDS}`])) ?? '');
}

export async function windowsGitCommitFiles(cwd: string, hash: string): Promise<CommitFile[] | undefined> {
  const status = await git(cwd, ['show', '--format=', '--relative', '--name-status', '-M', hash]);
  if (status === null) return undefined;
  const numstat = (await git(cwd, ['show', '--format=', '--relative', '--numstat', '-M', hash])) ?? '';
  return parseCommitFiles(status, numstat);
}

/** The file as it was at `rev` (`rel` is relative to `cwd`). */
export function windowsGitRevText(cwd: string, rel: string, rev: string): Promise<string | null> {
  return git(cwd, ['show', `${rev}:./${rel.replace(/\\/g, '/')}`]);
}

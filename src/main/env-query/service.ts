import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import type { EnvironmentRef } from '@shared/types/env';
import { codexConfigBackupName } from '../agents/codex-config';
import { decodeFile, encodeFile, MAX_EDIT_BYTES, type Eol, type FileReadResult, type FileWriteResult } from '../files/io';
import { parseHelperGitStat, parseStatus, windowsGitChanges, windowsGitHeadText, windowsGitStatusAll, type Changes } from '../git/changes';
import { gitBranchOf } from '../shell/git';
import { WslHelperClient, type WslOp } from './wsl-helper';

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export type DirListResult = { ok: true; entries: DirEntry[] } | { ok: false };

/**
 * The only way completion providers touch the system. Every method is a fixed, read-only
 * operation; none of them runs text taken from the command line.
 */
export interface EnvironmentQuery {
  listDir(env: EnvironmentRef, dir: string): Promise<DirEntry[]>;
  /** Like listDir, but keeps an unreadable directory distinct from an empty one. */
  listDirResult(env: EnvironmentRef, dir: string): Promise<DirListResult>;
  /** Starts the helper for a WSL environment ahead of the first query. */
  warm?(env: EnvironmentRef): void;
  readSmallText(env: EnvironmentRef, file: string, maxBytes: number): Promise<string | null>;
  gitBranches(env: EnvironmentRef, cwd: string): Promise<string[]>;
  gitBranch(env: EnvironmentRef, cwd: string): Promise<string | undefined>;
  listExecutables(env: EnvironmentRef): Promise<string[]>;
  homeDir(env: EnvironmentRef): Promise<string>;
  gitChanges(env: EnvironmentRef, cwd: string): Promise<Changes | undefined>;
  /** Status of every path below `cwd` (ignored ones as "!!"), for colouring the file tree. */
  gitStatusAll(env: EnvironmentRef, cwd: string): Promise<Array<{ path: string; status: string }> | undefined>;
  /** Codex's config.toml: null when the file does not exist yet. */
  readCodexConfig(env: EnvironmentRef): Promise<string | null | undefined>;
  /** Writes it after saving the old file under a timestamped backup name. */
  writeCodexConfig(env: EnvironmentRef, content: string): Promise<boolean>;
  /** Text files below `root` (the tab's folder). Paths that resolve outside it are refused, symlinks included. */
  readTextFile(env: EnvironmentRef, root: string, abs: string): Promise<FileReadResult>;
  writeTextFile(
    env: EnvironmentRef, root: string, abs: string, text: string, eol: Eol, bom: boolean, expectMtimeMs?: number
  ): Promise<FileWriteResult>;
  statFile(env: EnvironmentRef, root: string, abs: string): Promise<{ mtimeMs: number; size: number } | null>;
  /** The file as committed in HEAD; undefined when it is not tracked. */
  gitHeadText(env: EnvironmentRef, cwd: string, rel: string): Promise<string | undefined>;
}

const TTL = 5 * 60_000;
type Lane = 'fast' | 'slow';
const SLOW_OPS = new Set<WslOp>(['cmds', 'branches', 'branch', 'gitstat', 'gitall', 'headtext']);

export class EnvironmentQueryService implements EnvironmentQuery {
  private helpers = new Map<string, WslHelperClient>();
  private exeCache = new Map<string, { at: number; key: string; names: string[] }>();
  private homeCache = new Map<string, string>();

  /**
   * Two helper processes per distribution: git and PATH scans can take seconds and the helper answers one request
   * at a time, so they must not hold up listing or reading files.
   */
  helper(distro: string, lane: Lane = 'fast'): WslHelperClient {
    const key = `${lane}:${distro}`;
    let h = this.helpers.get(key);
    if (!h) {
      h = new WslHelperClient(distro, lane === 'slow');
      this.helpers.set(key, h);
    }
    return h;
  }

  private ask(distro: string, op: WslOp, args: string[] = [], timeoutMs?: number): Promise<string | null> {
    return this.helper(distro, SLOW_OPS.has(op) ? 'slow' : 'fast').request(op, args, timeoutMs);
  }

  /** Starts the file lane early so the first listing does not pay for starting WSL. */
  warm(env: EnvironmentRef): void {
    if (env.kind === 'wsl') void this.helper(env.distro).request('ping', [], 8000);
  }

  async listDir(env: EnvironmentRef, dir: string): Promise<DirEntry[]> {
    const result = await this.listDirResult(env, dir);
    return result.ok ? result.entries : [];
  }

  async listDirResult(env: EnvironmentRef, dir: string): Promise<DirListResult> {
    if (env.kind === 'wsl') {
      // a helper that is still starting (or just restarted) can miss the first deadline: one more try
      let out = await this.ask(env.distro, 'lsd', [dir], 4000);
      if (out === null) out = await this.ask(env.distro, 'lsd', [dir], 6000);
      if (!out?.startsWith('OK\n')) return { ok: false };
      const entries = out.slice(3)
        .split('\n')
        .filter(Boolean)
        .map((l) => (l.endsWith('/') ? { name: l.slice(0, -1), isDir: true } : { name: l, isDir: false }));
      return { ok: true, entries };
    }
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const out: DirEntry[] = [];
      for (const e of entries.slice(0, 2000)) {
        let isDir = e.isDirectory();
        if (!isDir && e.isSymbolicLink()) isDir = await stat(join(dir, e.name)).then((s) => s.isDirectory(), () => false);
        out.push({ name: e.name, isDir });
      }
      return { ok: true, entries: out };
    } catch {
      return { ok: false };
    }
  }

  async readSmallText(env: EnvironmentRef, file: string, maxBytes: number): Promise<string | null> {
    if (env.kind === 'wsl') return (await this.ask(env.distro, 'cat', [file, String(maxBytes)], 2000)) || null;
    try {
      const s = await stat(file);
      if (!s.isFile() || s.size > maxBytes) return null;
      return await readFile(file, 'utf8');
    } catch {
      return null;
    }
  }

  async gitBranches(env: EnvironmentRef, cwd: string): Promise<string[]> {
    if (env.kind === 'wsl') {
      const out = await this.ask(env.distro, 'branches', [cwd], 2500);
      return out ? out.split('\n').filter((b) => b && !b.endsWith('/HEAD')) : [];
    }
    return windowsGitBranches(cwd);
  }

  async gitBranch(env: EnvironmentRef, cwd: string): Promise<string | undefined> {
    if (env.kind === 'wsl') return (await this.ask(env.distro, 'branch', [cwd], 2000)) || undefined;
    return gitBranchOf(cwd);
  }

  async listExecutables(env: EnvironmentRef): Promise<string[]> {
    const k = env.kind === 'windows' ? 'windows' : env.distro;
    if (env.kind === 'wsl') {
      const hit = this.exeCache.get(k);
      if (hit && Date.now() - hit.at < TTL) return hit.names;
      const out = await this.ask(env.distro, 'cmds', [], 6000);
      const names = out ? out.split('\n').filter(Boolean) : [];
      if (names.length) this.exeCache.set(k, { at: Date.now(), key: '', names });
      return names;
    }
    const pathEnv = process.env['PATH'] ?? '';
    const hit = this.exeCache.get(k);
    if (hit && hit.key === pathEnv && Date.now() - hit.at < TTL) return hit.names;
    const exts = (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';').filter(Boolean);
    const names = new Set<string>();
    await Promise.all(
      pathEnv.split(';').filter(Boolean).map(async (dir) => {
        try {
          for (const f of await readdir(dir)) {
            const dot = f.lastIndexOf('.');
            if (dot > 0 && exts.includes(f.slice(dot).toLowerCase())) names.add(f.slice(0, dot));
          }
        } catch {
          /* unreadable PATH entry */
        }
      })
    );
    const list = [...names];
    this.exeCache.set(k, { at: Date.now(), key: pathEnv, names: list });
    return list;
  }

  async homeDir(env: EnvironmentRef): Promise<string> {
    if (env.kind === 'windows') return homedir();
    const hit = this.homeCache.get(env.distro);
    if (hit) return hit;
    const h = (await this.ask(env.distro, 'home', [], 3000)) || '/root';
    this.homeCache.set(env.distro, h);
    return h;
  }

  async gitChanges(env: EnvironmentRef, cwd: string): Promise<Changes | undefined> {
    if (env.kind === 'wsl') {
      const out = await this.ask(env.distro, 'gitstat', [cwd], 4000);
      return out ? parseHelperGitStat(out) : undefined;
    }
    return windowsGitChanges(cwd);
  }

  async gitHeadText(env: EnvironmentRef, cwd: string, rel: string): Promise<string | undefined> {
    if (env.kind === 'wsl') {
      const out = await this.ask(env.distro, 'headtext', [cwd, rel], 4000);
      return out?.startsWith('OK\n') ? out.slice(3) : undefined;
    }
    return (await windowsGitHeadText(cwd, rel)) ?? undefined;
  }

  async gitStatusAll(env: EnvironmentRef, cwd: string): Promise<Array<{ path: string; status: string }> | undefined> {
    if (env.kind === 'wsl') {
      const out = await this.ask(env.distro, 'gitall', [cwd], 4000);
      return out === null ? undefined : parseStatus(out);
    }
    return windowsGitStatusAll(cwd);
  }

  private codexDir = (): string => process.env['CODEX_HOME'] || join(homedir(), '.codex');

  async readCodexConfig(env: EnvironmentRef): Promise<string | null | undefined> {
    if (env.kind === 'wsl') {
      const out = await this.ask(env.distro, 'codexcfg', [], 3000);
      if (out === null) return undefined; // helper unavailable
      return out.startsWith('EXISTS\n') ? out.slice(7) : null;
    }
    try {
      return await readFile(join(this.codexDir(), 'config.toml'), 'utf8');
    } catch (e) {
      return (e as { code?: string }).code === 'ENOENT' ? null : undefined;
    }
  }

  async writeCodexConfig(env: EnvironmentRef, content: string): Promise<boolean> {
    const backup = codexConfigBackupName();
    if (env.kind === 'wsl') return (await this.ask(env.distro, 'codexcfgw', [content, backup], 5000)) === 'OK';
    const { copyFile, mkdir, rename, writeFile } = await import('node:fs/promises');
    const dir = this.codexDir();
    const file = join(dir, 'config.toml');
    try {
      await mkdir(dir, { recursive: true });
      await copyFile(file, join(dir, backup)).catch(() => undefined); // no old file, nothing to back up
      await writeFile(`${file}.arctri-tmp`, content, 'utf8');
      await rename(`${file}.arctri-tmp`, file);
      return true;
    } catch {
      return false;
    }
  }

  private async insideRoot(root: string, abs: string): Promise<boolean> {
    const { realpath } = await import('node:fs/promises');
    const rootReal = await realpath(root).catch(() => win32.resolve(root));
    // a file that does not exist yet is judged by its folder
    const target = await realpath(abs).catch(async () => join(await realpath(win32.dirname(abs)).catch(() => win32.dirname(abs)), win32.basename(abs)));
    const rel = win32.relative(rootReal, target);
    return !!rel && !rel.startsWith('..') && !win32.isAbsolute(rel);
  }

  async readTextFile(env: EnvironmentRef, root: string, abs: string): Promise<FileReadResult> {
    if (env.kind === 'wsl') {
      const out = await this.ask(env.distro, 'readfile', [abs, String(MAX_EDIT_BYTES), `${root}|`], 15000);
      if (out === null) return { ok: false, error: 'failed' };
      if (out.startsWith('ERR')) {
        const e = out.slice(4).trim();
        return { ok: false, error: e === 'toolarge' ? 'too-large' : e === 'notfound' ? 'not-found' : e === 'denied' ? 'denied' : 'failed' };
      }
      const nl = out.indexOf('\n');
      const [, ms, size] = out.slice(0, nl).split(' ');
      const d = decodeFile(Buffer.from(out.slice(nl + 1), 'base64'));
      if (d === 'binary') return { ok: false, error: 'binary' };
      return { ok: true, ...d, mtimeMs: Number(ms), size: Number(size) };
    }
    try {
      if (!(await this.insideRoot(root, abs))) return { ok: false, error: 'denied' };
      const st = await stat(abs);
      if (!st.isFile()) return { ok: false, error: 'not-found' };
      if (st.size > MAX_EDIT_BYTES) return { ok: false, error: 'too-large' };
      const d = decodeFile(await readFile(abs));
      if (d === 'binary') return { ok: false, error: 'binary' };
      return { ok: true, ...d, mtimeMs: Math.round(st.mtimeMs), size: st.size };
    } catch (e) {
      return { ok: false, error: (e as { code?: string }).code === 'ENOENT' ? 'not-found' : 'failed' };
    }
  }

  async writeTextFile(
    env: EnvironmentRef, root: string, abs: string, text: string, eol: Eol, bom: boolean, expectMtimeMs?: number
  ): Promise<FileWriteResult> {
    const bytes = encodeFile(text, eol, bom);
    if (bytes.length > MAX_EDIT_BYTES) return { ok: false, error: 'failed' };
    if (env.kind === 'wsl') {
      const out = await this.ask(env.distro, 
        'writefile', [abs, bytes.toString('base64'), `${root}|${expectMtimeMs ?? ''}`], 20000
      );
      if (out === null) return { ok: false, error: 'failed' };
      if (out.startsWith('OK')) return { ok: true, mtimeMs: Number(out.slice(3)) };
      if (out.startsWith('CONFLICT')) return { ok: false, error: 'conflict', mtimeMs: Number(out.slice(9)) };
      return { ok: false, error: out.includes('denied') ? 'denied' : 'failed' };
    }
    const { rename, stat: st, writeFile, unlink } = await import('node:fs/promises');
    try {
      if (!(await this.insideRoot(root, abs))) return { ok: false, error: 'denied' };
      const cur = await st(abs).catch(() => undefined);
      if (cur && expectMtimeMs !== undefined && Math.round(cur.mtimeMs) !== expectMtimeMs) {
        return { ok: false, error: 'conflict', mtimeMs: Math.round(cur.mtimeMs) };
      }
      const tmp = `${abs}.arctri-tmp`;
      try {
        await writeFile(tmp, bytes);
        await rename(tmp, abs);
      } catch (e) {
        await unlink(tmp).catch(() => undefined);
        throw e;
      }
      return { ok: true, mtimeMs: Math.round((await st(abs)).mtimeMs) };
    } catch {
      return { ok: false, error: 'failed' };
    }
  }

  async statFile(env: EnvironmentRef, root: string, abs: string): Promise<{ mtimeMs: number; size: number } | null> {
    if (env.kind === 'wsl') {
      const out = await this.ask(env.distro, 'statfile', [abs, '', `${root}|`], 3000);
      if (!out?.startsWith('OK')) return null;
      const [, ms, size] = out.split(' ');
      return { mtimeMs: Number(ms), size: Number(size) };
    }
    try {
      if (!(await this.insideRoot(root, abs))) return null;
      const st = await stat(abs);
      return { mtimeMs: Math.round(st.mtimeMs), size: st.size };
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const h of this.helpers.values()) h.dispose();
    this.helpers.clear();
  }
}

/** Branch names read straight from the repository files; git is never spawned. */
export async function windowsGitBranches(cwd: string): Promise<string[]> {
  let dir = cwd;
  for (let i = 0; i < 40; i++) {
    const dotGit = join(dir, '.git');
    const s = await stat(dotGit).catch(() => undefined);
    if (s) {
      let gitDir = dotGit;
      if (s.isFile()) {
        const m = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, 'utf8').catch(() => ''));
        if (!m) return [];
        gitDir = win32.resolve(dir, m[1]!.trim());
      }
      const common = (await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => '')).trim();
      const refsRoot = common ? win32.resolve(gitDir, common) : gitDir;
      const out = new Set<string>();
      const walk = async (sub: string, prefix: string, depth: number): Promise<void> => {
        if (depth > 6) return;
        for (const e of await readdir(join(refsRoot, sub), { withFileTypes: true }).catch(() => [])) {
          if (e.isDirectory()) await walk(join(sub, e.name), `${prefix}${e.name}/`, depth + 1);
          else if (e.name !== 'HEAD') out.add(prefix + e.name);
        }
      };
      await walk(join('refs', 'heads'), '', 0);
      await walk(join('refs', 'remotes'), '', 0);
      const packed = await readFile(join(refsRoot, 'packed-refs'), 'utf8').catch(() => '');
      for (const line of packed.split(/\r?\n/)) {
        const m = /^[0-9a-f]{40}\s+refs\/(?:heads|remotes)\/(.+)$/.exec(line);
        if (m && !m[1]!.endsWith('/HEAD')) out.add(m[1]!);
      }
      return [...out].sort();
    }
    const parent = win32.dirname(dir);
    if (parent === dir) return [];
    dir = parent;
  }
  return [];
}

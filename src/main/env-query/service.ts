import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import type { EnvironmentRef } from '@shared/types/env';
import { gitBranchOf } from '../shell/git';
import { WslHelperClient } from './wsl-helper';

export interface DirEntry {
  name: string;
  isDir: boolean;
}

/**
 * The only way completion providers touch the system. Every method is a fixed, read-only
 * operation; none of them runs text taken from the command line.
 */
export interface EnvironmentQuery {
  listDir(env: EnvironmentRef, dir: string): Promise<DirEntry[]>;
  readSmallText(env: EnvironmentRef, file: string, maxBytes: number): Promise<string | null>;
  gitBranches(env: EnvironmentRef, cwd: string): Promise<string[]>;
  gitBranch(env: EnvironmentRef, cwd: string): Promise<string | undefined>;
  listExecutables(env: EnvironmentRef): Promise<string[]>;
  homeDir(env: EnvironmentRef): Promise<string>;
}

const TTL = 5 * 60_000;

export class EnvironmentQueryService implements EnvironmentQuery {
  private helpers = new Map<string, WslHelperClient>();
  private exeCache = new Map<string, { at: number; key: string; names: string[] }>();
  private homeCache = new Map<string, string>();

  helper(distro: string): WslHelperClient {
    let h = this.helpers.get(distro);
    if (!h) {
      h = new WslHelperClient(distro);
      this.helpers.set(distro, h);
    }
    return h;
  }

  async listDir(env: EnvironmentRef, dir: string): Promise<DirEntry[]> {
    if (env.kind === 'wsl') {
      const out = await this.helper(env.distro).request('ls', [dir], 2500);
      if (!out) return [];
      return out
        .split('\n')
        .filter(Boolean)
        .map((l) => (l.endsWith('/') ? { name: l.slice(0, -1), isDir: true } : { name: l, isDir: false }));
    }
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const out: DirEntry[] = [];
      for (const e of entries.slice(0, 2000)) {
        let isDir = e.isDirectory();
        if (!isDir && e.isSymbolicLink()) isDir = await stat(join(dir, e.name)).then((s) => s.isDirectory(), () => false);
        out.push({ name: e.name, isDir });
      }
      return out;
    } catch {
      return [];
    }
  }

  async readSmallText(env: EnvironmentRef, file: string, maxBytes: number): Promise<string | null> {
    if (env.kind === 'wsl') return (await this.helper(env.distro).request('cat', [file, String(maxBytes)], 2000)) || null;
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
      const out = await this.helper(env.distro).request('branches', [cwd], 2500);
      return out ? out.split('\n').filter((b) => b && !b.endsWith('/HEAD')) : [];
    }
    return windowsGitBranches(cwd);
  }

  async gitBranch(env: EnvironmentRef, cwd: string): Promise<string | undefined> {
    if (env.kind === 'wsl') return (await this.helper(env.distro).request('branch', [cwd], 2000)) || undefined;
    return gitBranchOf(cwd);
  }

  async listExecutables(env: EnvironmentRef): Promise<string[]> {
    const k = env.kind === 'windows' ? 'windows' : env.distro;
    if (env.kind === 'wsl') {
      const hit = this.exeCache.get(k);
      if (hit && Date.now() - hit.at < TTL) return hit.names;
      const out = await this.helper(env.distro).request('cmds', [], 6000);
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
    const h = (await this.helper(env.distro).request('home', [], 3000)) || '/root';
    this.homeCache.set(env.distro, h);
    return h;
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

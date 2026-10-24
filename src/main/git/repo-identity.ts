import type { EnvironmentRef } from '@shared/types/env';
import { drvfsToWindows } from '../env-query/service';
import { runGit } from './actions';

export interface RepoIdentity {
  /** Same for every tab that works in the same worktree; a linked worktree of the same repository has its own. */
  repoId: string;
  root: string;
  gitDir: string;
  commonDir: string;
}

const envKey = (env: EnvironmentRef): string => (env.kind === 'wsl' ? `wsl:${env.distro}` : env.kind);

/** The folder as the machine running Arctri can open it (a WSL path is reached through the share), for fs checks. */
export function fsPathOf(env: EnvironmentRef, p: string): string {
  if (env.kind !== 'wsl' || !p.startsWith('/')) return p;
  return drvfsToWindows(p) ?? `\\\\wsl.localhost\\${env.distro}${p.replace(/\//g, '\\')}`;
}

/** One `git rev-parse` call: the worktree's top folder and where its git metadata lives. Undefined outside a repository. */
export async function resolveRepo(env: EnvironmentRef, cwd: string): Promise<RepoIdentity | undefined> {
  const r = await runGit(env, cwd, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'], { timeoutMs: 10_000 });
  if (r.code !== 0) return undefined;
  const [root, gitDir, common] = r.stdout.split(/\r?\n/).map((l) => l.trim());
  if (!root || !gitDir || !common) return undefined;
  // --git-common-dir may be relative to the folder git ran in
  const commonDir = /^([a-zA-Z]:)?[\\/]/.test(common) ? common : `${gitDir.replace(/[\\/]worktrees[\\/][^\\/]+$/, '')}`;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const key = env.kind === 'windows' || /^[a-zA-Z]:/.test(root) ? norm(root).toLowerCase() : norm(root);
  return { repoId: `${envKey(env)}|${key}`, root, gitDir, commonDir };
}

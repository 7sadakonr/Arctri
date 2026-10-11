import type { EnvPath } from '@shared/types/env';
import type { Prefs } from '@shared/prefs';

export type RecentProject = Prefs['recentProjects'][number];

export const MAX_RECENT = 20;

const sameProject = (a: RecentProject, b: RecentProject): boolean =>
  a.env === b.env && (a.distro ?? '') === (b.distro ?? '') && a.path.toLowerCase() === b.path.toLowerCase();

/** The list with `entry` first: a folder that was opened before moves up instead of appearing twice. */
export function pushRecent(list: RecentProject[], entry: RecentProject): RecentProject[] {
  return [entry, ...list.filter((x) => !sameProject(x, entry))].slice(0, MAX_RECENT);
}

export function removeRecent(list: RecentProject[], entry: RecentProject): RecentProject[] {
  return list.filter((x) => !sameProject(x, entry));
}

export function toRecent(p: EnvPath, now = Date.now()): RecentProject {
  if (p.env === 'wsl') return { env: 'wsl', distro: p.distro, path: p.path, openedAt: now };
  return { env: p.env, path: p.path, openedAt: now };
}

export function toEnvPath(r: RecentProject): EnvPath {
  if (r.env === 'wsl') return { env: 'wsl', distro: r.distro ?? '', path: r.path } as EnvPath;
  return { env: r.env, path: r.path } as EnvPath;
}

/** The last folder name ("C:\a\b" and "/a/b" both give "b"). */
export function projectName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** A user's home folder ("C:\\Users\\me", "/home/me", "/Users/me", "/root") says nothing about a project, so it is not remembered. */
export function isHomeFolder(path: string): boolean {
  return /^[a-z]:[\\/]+users[\\/]+[^\\/]+[\\/]*$/i.test(path) || /^\/(home\/[^/]+|Users\/[^/]+|root)\/*$/.test(path);
}

import { describe, expect, it } from 'vitest';
import { MAX_RECENT, isHomeFolder, projectName, toEnvPath, toRecent, pushRecent, type RecentProject } from './recent';

const win = (path: string, openedAt = 1): RecentProject => ({ env: 'windows', path, openedAt });

describe('pushRecent', () => {
  it('puts the newest first', () => {
    expect(pushRecent([win('C:\\a')], win('C:\\b', 2)).map((x) => x.path)).toEqual(['C:\\b', 'C:\\a']);
  });
  it('moves a folder that was opened before instead of duplicating it', () => {
    const r = pushRecent([win('C:\\a'), win('C:\\b')], win('c:\\B', 5));
    expect(r.map((x) => x.path)).toEqual(['c:\\B', 'C:\\a']);
  });
  it('keeps the same path in two WSL distros apart', () => {
    const a: RecentProject = { env: 'wsl', distro: 'Ubuntu', path: '/x', openedAt: 1 };
    const b: RecentProject = { env: 'wsl', distro: 'Debian', path: '/x', openedAt: 2 };
    expect(pushRecent([a], b)).toHaveLength(2);
  });
  it('is capped', () => {
    let list: RecentProject[] = [];
    for (let i = 0; i < MAX_RECENT + 5; i++) list = pushRecent(list, win(`C:\\p${i}`, i));
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]!.path).toBe(`C:\\p${MAX_RECENT + 4}`);
  });
});

describe('projectName', () => {
  it('takes the last segment', () => {
    expect(projectName('C:\\Users\\me\\Arctri')).toBe('Arctri');
    expect(projectName('/home/me/app/')).toBe('app');
  });
});

describe('folders on a Mac', () => {
  it('keeps the local environment through the recent list', () => {
    const r = toRecent({ env: 'local', path: '/Users/me/app' as never }, 7);
    expect(r).toEqual({ env: 'local', path: '/Users/me/app', openedAt: 7 });
    expect(toEnvPath(r)).toEqual({ env: 'local', path: '/Users/me/app' });
  });
  it('does not remember the home folder', () => {
    expect(isHomeFolder('/Users/me')).toBe(true);
    expect(isHomeFolder('/Users/me/')).toBe(true);
    expect(isHomeFolder('/Users/me/app')).toBe(false);
  });
});

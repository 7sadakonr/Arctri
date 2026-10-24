import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileWatcher } from './watcher';

const env = process.platform === 'win32' ? ({ kind: 'windows' } as const) : ({ kind: 'local' } as const);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('FileWatcher', () => {
  let watcher: FileWatcher | undefined;
  afterEach(() => watcher?.dispose());

  const setup = async () => {
    const root = await mkdtemp(join(tmpdir(), 'arctri-watch-'));
    await mkdir(join(root, 'sub'));
    const seen: string[][] = [];
    watcher = new FileWatcher((_id, dirs) => seen.push(dirs));
    return { root, seen, watcher };
  };

  it('reports a new file once, for the folder it is in', async () => {
    const { root, seen, watcher: w } = await setup();
    expect(w.setDirs('s', env, root, ['', 'sub'])).toBe(true);
    await writeFile(join(root, 'a.txt'), '1');
    await writeFile(join(root, 'b.txt'), '2');
    await wait(700);
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual(['']);
  });

  it('stops watching a folder that is no longer asked for', async () => {
    const { root, seen, watcher: w } = await setup();
    w.setDirs('s', env, root, ['', 'sub']);
    w.setDirs('s', env, root, ['']);
    await writeFile(join(root, 'sub', 'x.txt'), '1');
    await wait(500);
    expect(seen).toEqual([]);
  });

  it('does not watch a WSL folder', async () => {
    const { root, watcher: w } = await setup();
    expect(w.setDirs('s', { kind: 'wsl', distro: 'Ubuntu' }, root, [''])).toBe(false);
  });
});

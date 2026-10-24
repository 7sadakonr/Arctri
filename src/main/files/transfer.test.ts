import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvironmentQueryService } from '../env-query/service';
import { copyMany, copyName, moveMany } from './transfer';

const env = process.platform === 'win32' ? ({ kind: 'windows' } as const) : ({ kind: 'local' } as const);
const exists = (p: string) => stat(p).then(() => true, () => false);

describe('copyName', () => {
  it('adds "copy" before the extension and counts from the second one', () => {
    expect(copyName('a.txt', 1)).toBe('a copy.txt');
    expect(copyName('a.txt', 2)).toBe('a copy 2.txt');
    expect(copyName('.env', 1)).toBe('.env copy');
    expect(copyName('folder', 3)).toBe('folder copy 3');
    expect(copyName('x.tar.gz', 1)).toBe('x.tar copy.gz');
  });
});

describe('moving and copying between folders', () => {
  const setup = async () => {
    const root = await mkdtemp(join(tmpdir(), 'arctri-xfer-'));
    await mkdir(join(root, 'src', 'deep'), { recursive: true });
    await mkdir(join(root, 'dest'));
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'src', 'deep', 'd.txt'), 'd');
    return { root, q: new EnvironmentQueryService() };
  };

  it('copies a file, a second time under a new name, and a whole folder', async () => {
    const { root, q } = await setup();
    const dest = join(root, 'dest');
    const first = await copyMany(q, env, root, [join(root, 'a.txt')], dest);
    expect(first[0]?.to).toBe(join(dest, 'a.txt'));
    const second = await copyMany(q, env, root, [join(root, 'a.txt')], dest);
    expect(second[0]?.to).toBe(join(dest, 'a copy.txt'));
    const tree = await copyMany(q, env, root, [join(root, 'src')], dest);
    expect(tree[0]?.to).toBe(join(dest, 'src'));
    expect(await readFile(join(dest, 'src', 'deep', 'd.txt'), 'utf8')).toBe('d');
    expect(await exists(join(root, 'a.txt'))).toBe(true);
  });

  it('moves, and reports a taken name instead of replacing it', async () => {
    const { root, q } = await setup();
    const dest = join(root, 'dest');
    await writeFile(join(dest, 'a.txt'), 'other');
    const taken = await moveMany(q, env, root, [join(root, 'a.txt')], dest);
    expect(taken).toEqual([{ from: join(root, 'a.txt'), error: 'exists' }]);
    expect(await readFile(join(dest, 'a.txt'), 'utf8')).toBe('other');
    const moved = await moveMany(q, env, root, [join(root, 'src')], dest);
    expect(moved[0]?.to).toBe(join(dest, 'src'));
    expect(await exists(join(root, 'src'))).toBe(false);
  });

  it('refuses to put a folder inside itself, and does nothing for a folder already there', async () => {
    const { root, q } = await setup();
    const src = join(root, 'src');
    expect((await copyMany(q, env, root, [src], join(src, 'deep')))[0]?.error).toBe('denied');
    expect((await moveMany(q, env, root, [src], join(src, 'deep')))[0]?.error).toBeDefined();
    expect(await moveMany(q, env, root, [src], root)).toEqual([]);
  });
});

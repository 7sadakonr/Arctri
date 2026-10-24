import { describe, expect, it } from 'vitest';
import { drvfsToWindows, EnvironmentQueryService } from './service';

describe('drvfsToWindows', () => {
  it('maps a Windows drive seen from WSL back to its Windows path', () => {
    expect(drvfsToWindows('/mnt/d/Desktop/Arctri')).toBe('D:\\Desktop\\Arctri');
    expect(drvfsToWindows('/mnt/c')).toBe('C:\\');
    expect(drvfsToWindows('/home/me/proj')).toBeUndefined();
    expect(drvfsToWindows('/mnt/wsl/x')).toBeUndefined();
  });
});

describe('creating, renaming and deleting below the root', () => {
  const env = process.platform === 'win32' ? ({ kind: 'windows' } as const) : ({ kind: 'local' } as const);
  const setup = async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = await mkdtemp(join(tmpdir(), 'arctri-fsops-'));
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'a.txt'), 'a');
    return { root, join, svc: new EnvironmentQueryService() };
  };
  const exists = async (p: string) => (await import('node:fs/promises')).stat(p).then(() => true, () => false);

  it('creates a file and a folder, and refuses to replace one', async () => {
    const { root, join, svc } = await setup();
    expect(await svc.createEntry(env, root, join(root, '.env'), 'file')).toEqual({ ok: true });
    expect(await svc.createEntry(env, root, join(root, 'new'), 'dir')).toEqual({ ok: true });
    expect(await exists(join(root, '.env'))).toBe(true);
    expect(await svc.createEntry(env, root, join(root, 'a.txt'), 'file')).toEqual({ ok: false, error: 'exists' });
  });

  it('renames, and refuses a taken name', async () => {
    const { root, join, svc } = await setup();
    expect(await svc.renameEntry(env, root, join(root, 'a.txt'), join(root, 'b.txt'))).toEqual({ ok: true });
    expect(await exists(join(root, 'b.txt'))).toBe(true);
    expect(await svc.renameEntry(env, root, join(root, 'b.txt'), join(root, 'sub'))).toEqual({ ok: false, error: 'exists' });
  });

  it('deletes a folder with what is in it, or hands it to the recycle bin when there is one', async () => {
    const { root, join, svc } = await setup();
    expect(await svc.deleteEntry(env, root, join(root, 'sub'))).toEqual({ ok: true });
    expect(await exists(join(root, 'sub'))).toBe(false);
    const trashed: string[] = [];
    expect(await svc.deleteEntry(env, root, join(root, 'a.txt'), async (p) => void trashed.push(p))).toEqual({ ok: true });
    expect(trashed).toEqual([join(root, 'a.txt')]);
    expect(await svc.deleteEntry(env, root, join(root, 'missing'))).toEqual({ ok: false, error: 'not-found' });
  });

  it('never touches the root or anything outside it', async () => {
    const { root, join, svc } = await setup();
    const outside = join(root, '..', 'arctri-outside.txt');
    expect(await svc.deleteEntry(env, root, root)).toEqual({ ok: false, error: 'denied' });
    expect(await svc.renameEntry(env, root, root, join(root, 'x'))).toEqual({ ok: false, error: 'denied' });
    expect(await svc.renameEntry(env, root, join(root, 'a.txt'), outside)).toEqual({ ok: false, error: 'denied' });
    expect(await svc.createEntry(env, root, outside, 'file')).toEqual({ ok: false, error: 'denied' });
    expect(await exists(outside)).toBe(false);
  });
});

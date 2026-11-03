import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findPastedImage, projectKey } from './claude-images';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arctri-ci-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (project: string, session: string, file: string, ageSec = 0): string => {
  const dir = join(root, 'claude-1000', project, session, 'images');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file);
  writeFileSync(p, 'x');
  const t = new Date(Date.now() - ageSec * 1000);
  utimesSync(p, t, t);
  return p;
};

describe('projectKey', () => {
  it('turns every non-alphanumeric character into a dash', () => {
    expect(projectKey('/mnt/d/Desktop/Arctri')).toBe('-mnt-d-Desktop-Arctri');
    expect(projectKey('D:\\Desktop\\Arctri')).toBe('D--Desktop-Arctri');
  });
});

describe('findPastedImage', () => {
  it('finds image N of a known session', async () => {
    const p = put('-proj', 's1', '2.png');
    put('-proj', 's1', '3.png');
    expect(await findPastedImage([root], '/proj', 's1', 2)).toBe(p);
  });
  it('does not take #1 for #11 or another extension of another number', async () => {
    put('-proj', 's1', '11.png');
    expect(await findPastedImage([root], '/proj', 's1', 1)).toBeUndefined();
  });
  it('without a session id takes the newest session of the tab\'s own project', async () => {
    put('-mnt-d-Desktop-Arctri', 'old', '1.png', 100);
    const fresh = put('-mnt-d-Desktop-Arctri', 'new', '1.png', 1);
    put('-other', 'x', '1.png', 0);
    expect(await findPastedImage([root], '/mnt/d/Desktop/Arctri', undefined, 1)).toBe(fresh);
  });
  it('is undefined when nothing was pasted', async () => {
    expect(await findPastedImage([root], '/proj', 's1', 1)).toBeUndefined();
  });
});

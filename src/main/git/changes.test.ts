import { describe, expect, it } from 'vitest';
import { combineChanges, parseHelperGitStat, parseNumstat, parseStatus } from './changes';

describe('git changes parsing', () => {
  it('reads porcelain status including renames, quotes and Thai names', () => {
    const s = parseStatus(' M src/app.ts\n?? new file.txt\nA  "with space.md"\nR  old.ts -> new.ts\n M ไฟล์ไทย.txt\n');
    expect(s).toEqual([
      { status: ' M', path: 'src/app.ts' },
      { status: '??', path: 'new file.txt' },
      { status: 'A ', path: 'with space.md' },
      { status: 'R ', path: 'new.ts' },
      { status: ' M', path: 'ไฟล์ไทย.txt' }
    ]);
  });

  it('reads numstat, binary files and renames with braces', () => {
    const n = parseNumstat('3\t1\tsrc/app.ts\n-\t-\timg.png\n2\t0\tsrc/{old => new}/x.ts\n');
    expect(n.get('src/app.ts')).toEqual({ added: 3, deleted: 1 });
    expect(n.get('img.png')).toEqual({ added: 0, deleted: 0 });
    expect(n.get('src/new/x.ts')).toEqual({ added: 2, deleted: 0 });
  });

  it('combines both and totals them; untracked files count as changed without line numbers', () => {
    const c = combineChanges(' M a.ts\n?? b.ts\n', '3\t1\ta.ts\n');
    expect(c.files).toHaveLength(2);
    expect(c.added).toBe(3);
    expect(c.deleted).toBe(1);
  });

  it('parses the WSL helper sections and returns undefined outside a repository', () => {
    const c = parseHelperGitStat('##STATUS\n M a.ts\n##NUMSTAT\n5\t2\ta.ts\n');
    expect(c).toMatchObject({ added: 5, deleted: 2 });
    expect(parseHelperGitStat('')).toBeUndefined();
  });
});

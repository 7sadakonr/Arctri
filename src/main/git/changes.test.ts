import { describe, expect, it } from 'vitest';
import {
  combineChanges, parseCommitFiles, parseHelperGitShow, parseHelperGitStat, parseLog, parseNumstat, parseRefs, parseStatus
} from './changes';

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

  it('drops entries outside the working folder and keeps ignored markers', () => {
    expect(parseStatus(' M ../other/x.ts\n M inside.ts\n!! build/\n?? ../y\n')).toEqual([
      { status: ' M', path: 'inside.ts' },
      { status: '!!', path: 'build/' }
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
    // clean repository and untracked-only repository: the numstat section is empty and has no trailing newline
    expect(parseHelperGitStat('##STATUS\n##NUMSTAT')).toEqual({ files: [], added: 0, deleted: 0 });
    expect(parseHelperGitStat('##STATUS\n?? new.txt\n##NUMSTAT')?.files.map((f) => f.path)).toEqual(['new.txt']);
  });
});

describe('parseRefs', () => {
  it('splits local and remote branches, marks the current one and reads ahead/behind', () => {
    const r = parseRefs(
      'refs/heads/main\t*\torigin/main\tahead 2, behind 1\n' +
      'refs/heads/feat/x\t \t\t\n' +
      'refs/remotes/origin/HEAD\t \t\t\n' +
      'refs/remotes/origin/main\t \t\t\n'
    );
    expect(r.current).toBe('main');
    expect(r.local).toEqual([{ name: 'main', upstream: 'origin/main', ahead: 2, behind: 1 }, { name: 'feat/x' }]);
    expect(r.remote).toEqual([{ name: 'origin/main' }]);
  });
});

describe('parseLog', () => {
  it('reads commits, their refs and a subject that contains a tab', () => {
    const c = parseLog('a'.repeat(40) + '\taaaaaaa\tAda\t1700000000\tHEAD -> main, origin/main, tag: v1\tfix: a\tb\n' + 'not a commit line\n');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ short: 'aaaaaaa', author: 'Ada', time: 1700000000, subject: 'fix: a\tb' });
    expect(c[0]!.refs).toEqual(['main', 'origin/main', 'tag: v1']);
  });
});

describe('parseCommitFiles', () => {
  it('joins name-status with numstat, including renames', () => {
    const files = parseCommitFiles('M\tsrc/a.ts\nA\tnew.txt\nR100\told/n.ts\tnew/n.ts\nD\tgone.md', '3\t1\tsrc/a.ts\n5\t0\tnew.txt\n0\t0\told/{n.ts => n2.ts}\n-\t-\tgone.md');
    expect(files.map((f) => `${f.status}:${f.path}:${f.added}/${f.deleted}`)).toEqual([
      'M:src/a.ts:3/1', 'A:new.txt:5/0', 'R:new/n.ts:0/0', 'D:gone.md:0/0'
    ]);
  });

  it('reads the helper format', () => {
    expect(parseHelperGitShow('##STATUS\nM\tx\n##NUMSTAT\n1\t2\tx')).toEqual([{ path: 'x', status: 'M', added: 1, deleted: 2 }]);
    expect(parseHelperGitShow('')).toBeUndefined();
  });
});

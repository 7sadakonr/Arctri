import { describe, expect, it } from 'vitest';
import { quoteForShell, tokenize } from './tokenize';
import { matchScore, rankItems } from './rank';
import type { CompletionItem } from '../types/completion';

const tk = (line: string, shell: 'bash' | 'pwsh' = 'bash', cursor = line.length) => tokenize(line, cursor, shell);

describe('tokenize', () => {
  it('finds the current word and command position', () => {
    const a = tk('git che');
    expect(a.words).toEqual(['git', 'che']);
    expect(a.current.value).toBe('che');
    expect(a.isCommandPosition).toBe(false);
    expect(tk('gi').isCommandPosition).toBe(true);
    expect(tk('git ').current.value).toBe('');
    expect(tk('git ').index).toBe(1);
  });

  it('starts a new command after separators', () => {
    expect(tk('ls | gr').isCommandPosition).toBe(true);
    expect(tk('cd a && git ch').words).toEqual(['git', 'ch']);
    expect(tk('echo hi; ').isCommandPosition).toBe(true);
  });

  it('handles quotes, escapes and unfinished quotes per shell', () => {
    const open = tk('cat "my fi');
    expect(open.current.value).toBe('my fi');
    expect(open.current.quote).toBe('"');
    expect(open.current.open).toBe(true);
    expect(tk('cat my\\ fi').current.value).toBe('my fi');
    expect(tk("cat 'a b'", 'pwsh').words).toEqual(['cat', 'a b']);
    expect(tk("echo 'it''s", 'pwsh').current.value).toBe("it's");
    expect(tk('dir C:\\Users\\Me', 'pwsh').current.value).toBe('C:\\Users\\Me');
  });

  it('works with Thai text and a cursor in the middle of the line', () => {
    const t = tk('echo สวัสดี น้ำ');
    expect(t.words).toEqual(['echo', 'สวัสดี', 'น้ำ']);
    const mid = tk('git status', 'bash', 6);
    expect(mid.current.value).toBe('st');
    expect(tk('git checkout feature/แก้', 'bash').current.value).toBe('feature/แก้');
  });
});

describe('quoteForShell', () => {
  it('quotes only what the shell needs', () => {
    expect(quoteForShell('C:\\My Dir\\f.txt', 'pwsh', '', { closeQuote: true })).toBe("'C:\\My Dir\\f.txt'");
    expect(quoteForShell("it's here", 'pwsh', '', { closeQuote: true })).toBe("'it''s here'");
    expect(quoteForShell('plain.txt', 'pwsh', '', { closeQuote: true })).toBe('plain.txt');
    expect(quoteForShell('my file (1).txt', 'bash', '', { closeQuote: true })).toBe('my\\ file\\ \\(1\\).txt');
    expect(quoteForShell('my file', 'bash', '"', { closeQuote: false })).toBe('my file');
    expect(quoteForShell('my file', 'bash', '"', { closeQuote: true })).toBe('my file"');
  });
});

describe('ranking', () => {
  it('orders exact, prefix, boundary, subsequence', () => {
    const s = (c: string) => matchScore(c, 'sta', true);
    expect(matchScore('sta', 'sta', true)).toBeGreaterThan(s('status'));
    expect(s('status')).toBeGreaterThan(s('git-status'));
    expect(s('git-status')).toBeGreaterThan(s('sxtxa'));
    expect(s('zzz')).toBe(0);
    expect(matchScore('Status', 'sta', false)).toBe(0);
  });

  it('removes duplicates and limits', () => {
    const item = (label: string, score: number): CompletionItem => ({
      label, insertText: label, replace: [0, 1], kind: 'command', source: 't', score
    });
    const r = rankItems([item('a', 1), item('a', 5), item('b', 3)], 5);
    expect(r.map((x) => x.label)).toEqual(['a', 'b']);
    expect(r[0]!.score).toBe(5);
    expect(rankItems([item('a', 1), item('b', 2), item('c', 3)], 2)).toHaveLength(2);
  });
});

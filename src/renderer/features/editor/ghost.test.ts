import { describe, expect, it } from 'vitest';
import { visibleGhost } from './ghost';

describe('visibleGhost', () => {
  it('shrinks as the typed text matches the prediction', () => {
    expect(visibleGhost('git', 'git status', true)).toBe(' status');
    expect(visibleGhost('git s', 'git status', true)).toBe('tatus');
    expect(visibleGhost('git status', 'git status', true)).toBe('');
  });
  it('hides at once on a different character, caret elsewhere, or multiline text', () => {
    expect(visibleGhost('git x', 'git status', true)).toBe('');
    expect(visibleGhost('git', 'git status', false)).toBe('');
    expect(visibleGhost('a\nb', 'a\nb c', true)).toBe('');
    expect(visibleGhost('git', '', true)).toBe('');
  });
});

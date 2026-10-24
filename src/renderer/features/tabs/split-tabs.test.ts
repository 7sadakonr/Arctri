import { describe, expect, it } from 'vitest';
import { splitTabs } from './split-tabs';

describe('splitTabs', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  it('shows everything when it fits', () => {
    expect(splitTabs(ids, {}, 'a', 2000)).toEqual({ shown: ids, hidden: [] });
  });
  it('hides the overflow but never the active tab', () => {
    const r = splitTabs(ids, {}, 'f', 64 + 110 * 3);
    expect(r.shown).toHaveLength(3);
    expect(r.shown).toContain('f');
    expect([...r.shown, ...r.hidden].sort()).toEqual(ids);
  });
  it('pinned tabs are always shown', () => {
    const r = splitTabs(['p', ...ids], { p: true }, 'a', 64 + 110 * 3);
    expect(r.shown).toContain('p');
    expect(r.hidden).not.toContain('p');
  });
});

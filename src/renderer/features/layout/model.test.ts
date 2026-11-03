import { describe, expect, it } from 'vitest';
import {
  activeSessionOf, applyDrop, closeSessionTabs, closeTab, dropOnDivider, dropOnEdge, dropOnRoot, emptyLayout, fileKey, insertTab, moveTab, openFile,
  sessionKey, type LayoutState, type TabRef
} from './model';
import { groupIds } from './tree';

const session = (id: string): TabRef => ({ kind: 'session', key: sessionKey(id), sessionId: id });

function withSessions(...ids: string[]): LayoutState {
  return ids.reduce((s, id) => insertTab(s, session(id)), emptyLayout());
}

describe('layout model', () => {
  it('the first tab creates the first group and the focus', () => {
    const s = withSessions('a');
    expect(groupIds(s.root)).toHaveLength(1);
    expect(activeSessionOf(s)).toBe('a');
  });

  it('dropping a tab on the right edge gives it a group of its own, and both stay visible', () => {
    const s0 = withSessions('a', 'b');
    const g = s0.focused!;
    const s1 = dropOnEdge(s0, sessionKey('b'), g, 'right');
    expect(groupIds(s1.root)).toHaveLength(2);
    const [left, right] = groupIds(s1.root).map((id) => s1.groups[id]!);
    expect(left!.tabs).toEqual([sessionKey('a')]);
    expect(right!.tabs).toEqual([sessionKey('b')]);
    expect(s1.focused).toBe(right!.id);
  });

  it('cannot split a group off its only tab', () => {
    const s0 = withSessions('a');
    expect(dropOnEdge(s0, sessionKey('a'), s0.focused!, 'left')).toBe(s0);
  });

  it('emptying a group closes it and the grid closes up', () => {
    const s0 = withSessions('a', 'b');
    const s1 = dropOnEdge(s0, sessionKey('b'), s0.focused!, 'bottom');
    const s2 = moveTab(s1, sessionKey('b'), groupIds(s1.root)[0]!);
    expect(groupIds(s2.root)).toHaveLength(1);
    expect(s2.groups[s2.focused!]!.tabs).toEqual([sessionKey('a'), sessionKey('b')]);
  });

  it('reorders inside a group', () => {
    const s0 = withSessions('a', 'b', 'c');
    const s1 = moveTab(s0, sessionKey('c'), s0.focused!, 0);
    expect(s1.groups[s1.focused!]!.tabs).toEqual([sessionKey('c'), sessionKey('a'), sessionKey('b')]);
  });

  it('closing the active tab shows its neighbour', () => {
    const s0 = withSessions('a', 'b', 'c');
    const s1 = closeTab({ ...s0 }, sessionKey('c'));
    expect(s1.groups[s1.focused!]!.active).toBe(sessionKey('b'));
    expect(s1.tabs[sessionKey('c')]).toBeUndefined();
  });

  describe('files', () => {
    it('the first file opens in a new group at the right; a second one joins it', () => {
      const s0 = withSessions('a');
      const s1 = openFile(s0, { sessionId: 'a', rel: 'x.ts', mode: 'file' });
      expect(groupIds(s1.root)).toHaveLength(2);
      const s2 = openFile(s1, { sessionId: 'a', rel: 'y.ts', mode: 'diff' });
      expect(groupIds(s2.root)).toHaveLength(2);
      expect(s2.groups[s2.focused!]!.tabs).toEqual([fileKey('a', 'x.ts'), fileKey('a', 'y.ts')]);
    });

    it('opening a file twice shows the same tab, and switching to the diff keeps it', () => {
      const s1 = openFile(withSessions('a'), { sessionId: 'a', rel: 'x.ts', mode: 'file' });
      const s2 = openFile(s1, { sessionId: 'a', rel: 'x.ts', mode: 'diff' });
      expect(Object.values(s2.tabs).filter((t) => t.kind === 'file')).toHaveLength(1);
      expect((s2.tabs[fileKey('a', 'x.ts')] as { mode: string }).mode).toBe('diff');
    });

    it('a preview tab is replaced by the next preview', () => {
      const s1 = openFile(withSessions('a'), { sessionId: 'a', rel: 'x.ts', mode: 'diff', preview: true });
      const s2 = openFile(s1, { sessionId: 'a', rel: 'y.ts', mode: 'diff', preview: true });
      expect(Object.keys(s2.tabs).filter((k) => k.startsWith('f:'))).toEqual([fileKey('a', 'y.ts')]);
      expect(s2.groups[s2.focused!]!.tabs).toEqual([fileKey('a', 'y.ts')]);
    });

    it('closing a session closes its files, and the empty group goes away', () => {
      const s1 = openFile(withSessions('a', 'b'), { sessionId: 'a', rel: 'x.ts', mode: 'file' });
      const s2 = closeSessionTabs(s1, 'a');
      expect(Object.values(s2.tabs).every((t) => t.sessionId === 'b')).toBe(true);
      expect(groupIds(s2.root)).toHaveLength(1);
    });
  });

  describe('dropping on an edge of the whole grid', () => {
    it('a tab dropped on the bottom edge gets a group under every column', () => {
      const s0 = withSessions('a', 'b', 'c');
      const s1 = dropOnEdge(s0, sessionKey('b'), s0.focused!, 'right'); // a c | b
      const s2 = dropOnRoot(s1, sessionKey('c'), 'bottom');
      if (s2.root?.type !== 'split') throw new Error();
      expect(s2.root.dir).toBe('col');
      expect(s2.root.sizes).toEqual([0.5, 0.5]);
      const [top, bottom] = s2.root.children;
      expect(top).toMatchObject({ type: 'split', dir: 'row' });
      expect(bottom).toMatchObject({ type: 'group' });
      expect(s2.groups[(bottom as { id: string }).id]!.tabs).toEqual([sessionKey('c')]);
      expect(s2.focused).toBe((bottom as { id: string }).id);
    });

    it('does nothing for the only tab of the only group', () => {
      const s0 = withSessions('a');
      expect(dropOnRoot(s0, sessionKey('a'), 'left')).toBe(s0);
    });

    it('a group left empty by the move closes up', () => {
      const s0 = withSessions('a', 'b');
      const s1 = dropOnEdge(s0, sessionKey('b'), s0.focused!, 'right'); // a | b
      const s2 = dropOnRoot(s1, sessionKey('b'), 'right'); // b moves to a new group at the right edge, its old group goes
      expect(groupIds(s2.root)).toHaveLength(2);
      expect(Object.values(s2.groups).every((g) => g.tabs.length === 1)).toBe(true);
    });
  });

  describe('dropping on a divider', () => {
    it('a tab dropped on the line between two columns gets a full-height group between them', () => {
      const s0 = withSessions('a', 'b', 'c');
      const s1 = dropOnEdge(s0, sessionKey('b'), s0.focused!, 'right'); // [a c] | [b]
      const root = s1.root;
      if (root?.type !== 'split') throw new Error();
      const s2 = dropOnDivider(s1, sessionKey('c'), root.id, 0);
      expect(groupIds(s2.root)).toHaveLength(3);
      if (s2.root?.type !== 'split') throw new Error();
      expect(s2.root.dir).toBe('row');
      const middle = s2.root.children[1]!;
      expect(middle.type).toBe('group');
      expect(s2.groups[(middle as { id: string }).id]!.tabs).toEqual([sessionKey('c')]);
    });
  });

  describe('applyDrop', () => {
    const s0 = withSessions('a', 'b', 'c');
    const key = sessionKey('c');
    const g = s0.focused!;
    const same = (a: LayoutState, b: LayoutState) =>
      JSON.stringify(Object.values(a.groups).map((x) => x.tabs)) === JSON.stringify(Object.values(b.groups).map((x) => x.tabs));
    it('each target does what its own function does', () => {
      expect(same(applyDrop(s0, key, { kind: 'strip', groupId: g, index: 0 }), moveTab(s0, key, g, 0))).toBe(true);
      expect(same(applyDrop(s0, key, { kind: 'pane', groupId: g, zone: 'right' }), dropOnEdge(s0, key, g, 'right'))).toBe(true);
      expect(same(applyDrop(s0, key, { kind: 'root', edge: 'bottom' }), dropOnRoot(s0, key, 'bottom'))).toBe(true);
      expect(groupIds(applyDrop(s0, key, { kind: 'pane', groupId: g, zone: 'center' }).root)).toHaveLength(1);
    });
  });
});

import { create } from 'zustand';
import {
  activeSessionOf, applyDrop, closeSessionTabs, closeTab, dropOnEdge, dropOnRoot, emptyLayout, focusGroup, focusStep, groupOf,
  insertTab, moveTab, openEmptyGroup, openFile, pinFirst, pruneEmpty, reveal, sessionKey, toggleZoom, updateFile, type DropTarget, type LayoutState, type OpenFile
} from '@/features/layout/model';
import { setSizes as setTreeSizes, type Edge } from '@/features/layout/tree';
import { useEditors, parkedText } from './editors';
import { useSessions } from './sessions';

export type { FileTab, TabRef, Group } from '@/features/layout/model';

interface LayoutActions {
  /** Runs one change of the grid, then tells the sessions store which session is in front. */
  apply(fn: (s: LayoutState) => LayoutState): void;
  activate(key: string): void;
  focus(groupId: string): void;
  openFile(f: OpenFile): void;
  pinFile(key: string): void;
  setMode(key: string, mode: 'file' | 'diff'): void;
  close(key: string): void;
  move(key: string, groupId: string, index?: number): void;
  drop(key: string, groupId: string, edge: Edge): void;
  setSizes(splitId: string, sizes: number[]): void;
  zoom(groupId?: string): void;
  stepFocus(dir: 1 | -1): void;
  /** The focused group's tab to the right/left is shown (Ctrl+Tab). */
  stepTab(dir: 1 | -1): void;
  /** A new, empty group beside the focused one, with the focus: the next tab to open lands in it (call `pruneEmpty` after). */
  openEmptyGroup(edge: Edge): void;
  pruneEmpty(): void;
  /** Drops a tab on an edge of the whole grid: a group along the full width or height. */
  dropRoot(key: string, edge: Edge): void;
  /** Carries out a drop (the same function the drag preview simulates). */
  applyDrop(key: string, target: DropTarget): void;
}

export const useLayout = create<LayoutState & LayoutActions>()((set) => {
  const apply = (fn: (s: LayoutState) => LayoutState): void => {
    set((s) => fn(s));
    syncActive();
  };
  return {
    ...emptyLayout(),
    apply,
    activate: (key) => apply((s) => reveal(s, key)),
    focus: (id) => apply((s) => focusGroup(s, id)),
    openFile: (f) => apply((s) => openFile(s, f)),
    pinFile: (key) => apply((s) => updateFile(s, key, { preview: false })),
    setMode: (key, mode) => apply((s) => updateFile(s, key, { mode })),
    close: (key) => {
      parkedText.delete(key);
      useEditors.getState().setDirty(key, false);
      apply((s) => closeTab(s, key));
    },
    move: (key, groupId, index) => apply((s) => moveTab(s, key, groupId, index)),
    drop: (key, groupId, edge) => apply((s) => dropOnEdge(s, key, groupId, edge)),
    setSizes: (splitId, sizes) => set((s) => (s.root ? { root: setTreeSizes(s.root, splitId, sizes) } : s)),
    zoom: (id) => apply((s) => toggleZoom(s, id)),
    stepFocus: (dir) => apply((s) => focusStep(s, dir)),
    stepTab: (dir) =>
      apply((s) => {
        const g = s.focused ? s.groups[s.focused] : undefined;
        if (!g || g.tabs.length < 2) return s;
        return reveal(s, g.tabs[(g.tabs.indexOf(g.active) + dir + g.tabs.length) % g.tabs.length]!);
      }),
    openEmptyGroup: (edge) => set((s) => openEmptyGroup(s, edge)),
    pruneEmpty: () => apply(pruneEmpty),
    dropRoot: (key, edge) => apply((s) => dropOnRoot(s, key, edge)),
    applyDrop: (key, target) => apply((s) => applyDrop(s, key, target))
  };
});

/** The session in front is the one the focused group shows; the rest of the app keeps asking the sessions store. */
function syncActive(): void {
  const l = useLayout.getState();
  const sid = activeSessionOf(l);
  const sessions = useSessions.getState();
  if (sid && sessions.infos[sid]) {
    if (sid !== sessions.activeId) useSessions.setState({ activeId: sid });
  }
}

// ----- the layout follows the sessions: a new session gets a tab, a closed one loses all of its tabs -----

useSessions.subscribe((s, prev) => {
  const added = s.order.filter((id) => !prev.infos[id] && s.infos[id]);
  const removed = prev.order.filter((id) => !s.infos[id]);
  const layout = useLayout.getState();
  for (const id of removed) {
    for (const t of Object.values(layout.tabs)) if (t.sessionId === id) {
      parkedText.delete(t.key);
      useEditors.getState().setDirty(t.key, false);
    }
    layout.apply((l) => closeSessionTabs(l, id));
    // the sessions store has already picked a neighbour in order; prefer what the focused group shows now
    const sid = activeSessionOf(useLayout.getState());
    if (sid && useSessions.getState().infos[sid] && sid !== useSessions.getState().activeId) useSessions.setState({ activeId: sid });
  }
  for (const id of added) useLayout.getState().apply((l) => insertTab(l, { kind: 'session', key: sessionKey(id), sessionId: id }, { activate: s.activeId === id }));
  if (s.pinned !== prev.pinned) useLayout.getState().apply((l) => pinFirst(l, s.pinned));
  if (s.activeId && s.activeId !== prev.activeId && s.activeId !== activeSessionOf(useLayout.getState()) && s.infos[s.activeId]) {
    useLayout.getState().apply((l) => (groupOf(l, sessionKey(s.activeId!)) ? reveal(l, sessionKey(s.activeId!)) : l));
  }
});

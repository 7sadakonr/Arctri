import { groupIds, hasGroup, insertAtDivider, removeGroup, splitGroup, splitRoot, stepGroup, type Edge, type Node } from './tree';

export type Zone = Edge | 'center';

/** Where a dragged tab would land. */
export type DropTarget =
  | { kind: 'strip'; groupId: string; index: number }
  /** `small`: it was a side, but the pane is too small to split, so it joins the tabs. */
  | { kind: 'pane'; groupId: string; zone: Zone; small?: true }
  | { kind: 'root'; edge: Edge }
  /** On the divider after child `index` of a split: a new group the full length of the divider. */
  | { kind: 'divider'; splitId: string; index: number };

/** A tab in the grid: a terminal session, or a file (or a diff of it) of a session's folder. */
export type TabRef =
  | { kind: 'session'; key: string; sessionId: string }
  | {
      kind: 'file';
      key: string;
      sessionId: string;
      /** Identity within the session: the file's path, or `<rev>:<path>` for a file as a commit changed it. */
      rel: string;
      mode: 'file' | 'diff';
      /** The file's path when `rel` is not it. */
      path?: string;
      /** Shows the file as this commit changed it (read-only, against the commit's parent). */
      rev?: string;
      /** Opened by a single click in the Changes list: the next such click replaces this tab instead of adding another. */
      preview?: boolean;
    };

export type FileTab = Extract<TabRef, { kind: 'file' }>;

export interface Group {
  id: string;
  tabs: string[];
  active: string;
}

export interface LayoutState {
  root: Node | undefined;
  groups: Record<string, Group>;
  tabs: Record<string, TabRef>;
  focused: string | undefined;
  /** A group shown alone, filling the workspace, until it is restored. */
  zoomed: string | undefined;
}

export const emptyLayout = (): LayoutState => ({ root: undefined, groups: {}, tabs: {}, focused: undefined, zoomed: undefined });

export const sessionKey = (id: string): string => `s:${id}`;
export const fileKey = (id: string, rel: string): string => `f:${id}:${rel}`;

let groupSeq = 0;
export const newGroupId = (): string => `g${++groupSeq}`;

export const groupOf = (s: LayoutState, key: string): Group | undefined => Object.values(s.groups).find((g) => g.tabs.includes(key));

/** The session in front: the one whose tab (or file, or sidebar) is shown in the focused group. */
export function activeSessionOf(s: LayoutState): string | undefined {
  const g = s.focused ? s.groups[s.focused] : undefined;
  return g ? s.tabs[g.active]?.sessionId : undefined;
}

function withGroup(s: LayoutState, g: Group): LayoutState {
  return { ...s, groups: { ...s.groups, [g.id]: g } };
}

/** Puts a tab into a group (the focused one by default), creating the first group when the grid is empty. */
export function insertTab(s: LayoutState, tab: TabRef, at: { groupId?: string; index?: number; activate?: boolean } = {}): LayoutState {
  const activate = at.activate ?? true;
  let next: LayoutState = { ...s, tabs: { ...s.tabs, [tab.key]: tab } };
  let target = at.groupId && next.groups[at.groupId] ? at.groupId : next.focused && next.groups[next.focused] ? next.focused : groupIds(next.root)[0];
  if (!target) {
    target = newGroupId();
    next = { ...next, root: { type: 'group', id: target }, groups: { [target]: { id: target, tabs: [], active: '' } }, focused: target };
  }
  const g = next.groups[target]!;
  if (g.tabs.includes(tab.key)) return activate ? reveal(next, tab.key) : next;
  const tabs = [...g.tabs];
  tabs.splice(at.index === undefined ? tabs.length : Math.max(0, Math.min(at.index, tabs.length)), 0, tab.key);
  next = withGroup(next, { ...g, tabs, active: activate || !g.active ? tab.key : g.active });
  return activate ? { ...next, focused: target } : next;
}

/** Takes a tab out of its group (the tab itself stays known); an emptied group disappears and the grid closes up. */
function detachTab(s: LayoutState, key: string): LayoutState {
  const g = groupOf(s, key);
  if (!g) return s;
  const i = g.tabs.indexOf(key);
  const tabs = g.tabs.filter((x) => x !== key);
  if (tabs.length > 0) {
    const active = g.active === key ? tabs[Math.min(i, tabs.length - 1)]! : g.active;
    return withGroup(s, { ...g, tabs, active });
  }
  const { [g.id]: _gone, ...groups } = s.groups;
  const root = s.root ? removeGroup(s.root, g.id) : undefined;
  let focused = s.focused;
  if (focused === g.id) {
    const ids = groupIds(root);
    // prefer the group that was next to the one that closed
    const old = groupIds(s.root);
    focused = ids.includes(old[old.indexOf(g.id) + 1] ?? '') ? old[old.indexOf(g.id) + 1] : ids.includes(old[old.indexOf(g.id) - 1] ?? '') ? old[old.indexOf(g.id) - 1] : ids[0];
  }
  return { ...s, root, groups, focused, zoomed: s.zoomed === g.id ? undefined : s.zoomed };
}

export function closeTab(s: LayoutState, key: string): LayoutState {
  const next = detachTab(s, key);
  const { [key]: _t, ...tabs } = next.tabs;
  return { ...next, tabs };
}

export function closeSessionTabs(s: LayoutState, sessionId: string): LayoutState {
  return Object.values(s.tabs)
    .filter((t) => t.sessionId === sessionId)
    .reduce((acc, t) => closeTab(acc, t.key), s);
}

/** Shows a tab and gives its group the focus. */
export function reveal(s: LayoutState, key: string): LayoutState {
  const g = groupOf(s, key);
  if (!g) return s;
  return { ...withGroup(s, g.active === key ? g : { ...g, active: key }), focused: g.id };
}

/** Moves a tab into a group, at a position; within the same group this only reorders. */
export function moveTab(s: LayoutState, key: string, groupId: string, index?: number): LayoutState {
  const tab = s.tabs[key];
  const from = groupOf(s, key);
  if (!tab || !from || !s.groups[groupId]) return s;
  if (from.id === groupId) {
    const rest = from.tabs.filter((x) => x !== key);
    const at = index === undefined ? rest.length : Math.max(0, Math.min(index > from.tabs.indexOf(key) ? index - 1 : index, rest.length));
    rest.splice(at, 0, key);
    return reveal(withGroup(s, { ...from, tabs: rest }), key);
  }
  const detached = detachTab(s, key);
  return insertTab(detached, tab, { groupId, ...(index !== undefined ? { index } : {}) });
}

/** Drops a tab on an edge of the whole grid: its new group spans the full width or height (under or beside every pane). */
export function dropOnRoot(s: LayoutState, key: string, edge: Edge, ratio = 0.5): LayoutState {
  const from = groupOf(s, key);
  if (!s.root || !from || !s.tabs[key]) return s;
  if (groupIds(s.root).length === 1 && from.tabs.length === 1) return s; // the only tab of the only group: nothing to split off
  const id = newGroupId();
  const split: LayoutState = {
    ...s,
    root: splitRoot(s.root, edge, id, ratio),
    groups: { ...s.groups, [id]: { id, tabs: [], active: '' } }
  };
  return moveTab(split, key, id);
}

/** Drops a tab on the edge of a group: the tab gets a new group on that side. */
export function dropOnEdge(s: LayoutState, key: string, groupId: string, edge: Edge, ratio = 0.5): LayoutState {
  const g = s.groups[groupId];
  if (!g || !s.root || !s.tabs[key]) return s;
  if (g.tabs.length === 1 && g.tabs[0] === key) return s; // nothing to split off
  const id = newGroupId();
  const split: LayoutState = {
    ...s,
    root: splitGroup(s.root, groupId, edge, id, ratio),
    groups: { ...s.groups, [id]: { id, tabs: [], active: '' } }
  };
  return moveTab(split, key, id);
}

/** Opens an empty group at an edge of one group, for tabs that want a side of their own (a file). */
function splitBeside(s: LayoutState, beside: string, edge: Edge, ratio: number): { state: LayoutState; id: string } {
  const id = newGroupId();
  return {
    id,
    state: { ...s, root: splitGroup(s.root!, beside, edge, id, ratio), groups: { ...s.groups, [id]: { id, tabs: [], active: '' } } }
  };
}

export interface OpenFile {
  sessionId: string;
  rel: string;
  mode: 'file' | 'diff';
  path?: string;
  rev?: string;
  preview?: boolean;
}

export function openFile(s: LayoutState, f: OpenFile): LayoutState {
  const key = fileKey(f.sessionId, f.rel);
  const known = s.tabs[key];
  if (known && known.kind === 'file' && groupOf(s, key)) {
    const tab: FileTab = {
      ...known,
      mode: f.mode,
      ...(f.path ? { path: f.path } : {}),
      ...(f.rev ? { rev: f.rev } : {})
    };
    return reveal({ ...s, tabs: { ...s.tabs, [key]: tab } }, key);
  }
  const tab: FileTab = {
    kind: 'file',
    key,
    sessionId: f.sessionId,
    rel: f.rel,
    mode: f.mode,
    ...(f.path ? { path: f.path } : {}),
    ...(f.rev ? { rev: f.rev } : {}),
    ...(f.preview ? { preview: true } : {})
  };
  if (!s.root) return s;
  const isFile = (k: string) => s.tabs[k]?.kind === 'file';
  const focused = s.focused ? s.groups[s.focused] : undefined;
  let state = s;
  let target: string | undefined;
  if (focused && isFile(focused.active)) target = focused.id;
  else
    target =
      Object.values(s.groups).find((g) => g.tabs.some((k) => s.tabs[k]?.kind === 'file' && s.tabs[k]!.sessionId === f.sessionId))?.id ??
      Object.values(s.groups).find((g) => g.tabs.some(isFile))?.id;
  if (!target) {
    // beside the session's own terminal, so the file opens next to what it belongs to
    const home = groupOf(s, sessionKey(f.sessionId))?.id ?? focused?.id ?? groupIds(s.root)[0]!;
    const r = splitBeside(s, home, 'right', 0.45);
    state = r.state;
    target = r.id;
  }
  const g = state.groups[target]!;
  if (f.preview) {
    const old = g.tabs.find((k) => state.tabs[k]?.kind === 'file' && (state.tabs[k] as FileTab).preview);
    if (old) {
      const { [old]: _gone, ...tabs } = state.tabs;
      const swapped = withGroup({ ...state, tabs: { ...tabs, [key]: tab } }, { ...g, tabs: g.tabs.map((k) => (k === old ? key : k)), active: key });
      return { ...swapped, focused: target };
    }
  }
  return insertTab(state, tab, { groupId: target });
}

export function updateFile(s: LayoutState, key: string, patch: Partial<Pick<FileTab, 'mode' | 'preview'>>): LayoutState {
  const t = s.tabs[key];
  if (!t || t.kind !== 'file') return s;
  const next: FileTab = { ...t, ...patch };
  if (patch.preview === false) delete next.preview;
  return { ...s, tabs: { ...s.tabs, [key]: next } };
}

export const focusGroup = (s: LayoutState, id: string): LayoutState => (s.groups[id] ? { ...s, focused: id } : s);

export function focusStep(s: LayoutState, dir: 1 | -1): LayoutState {
  const to = s.focused ? stepGroup(s.root, s.focused, dir) : undefined;
  return to ? focusGroup(s, to) : s;
}

export function toggleZoom(s: LayoutState, id = s.focused): LayoutState {
  if (!id || !hasGroup(s.root, id)) return s;
  return { ...s, zoomed: s.zoomed === id ? undefined : id, focused: id };
}

/** The tabs of a group other than the given one, or to its right: for "close others" and "close to the right". */
export function siblingsOf(s: LayoutState, key: string, which: 'others' | 'right'): string[] {
  const g = groupOf(s, key);
  if (!g) return [];
  return which === 'others' ? g.tabs.filter((k) => k !== key) : g.tabs.slice(g.tabs.indexOf(key) + 1);
}

/** Groups left without a tab (a split whose new tab never arrived) are taken out of the grid. */
export function pruneEmpty(s: LayoutState): LayoutState {
  return Object.values(s.groups)
    .filter((g) => g.tabs.length === 0)
    .reduce((acc, g) => {
      const root = acc.root ? removeGroup(acc.root, g.id) : undefined;
      const { [g.id]: _gone, ...groups } = acc.groups;
      const focused = acc.focused === g.id ? groupIds(root)[0] : acc.focused;
      return { ...acc, root, groups, focused, zoomed: acc.zoomed === g.id ? undefined : acc.zoomed };
    }, s);
}

/** A group with no tab yet, at the edge of the focused group, and the focus on it: the next tab that opens lands there. */
export function openEmptyGroup(s: LayoutState, edge: Edge): LayoutState {
  if (!s.root || !s.focused) return s;
  const id = newGroupId();
  return { ...s, root: splitGroup(s.root, s.focused, edge, id), groups: { ...s.groups, [id]: { id, tabs: [], active: '' } }, focused: id };
}

/** Pinned session tabs sit at the left of their group (the order of the others is kept). */
export function pinFirst(s: LayoutState, pinned: Record<string, boolean>): LayoutState {
  const isPinned = (k: string) => {
    const tab = s.tabs[k];
    return tab?.kind === 'session' && !!pinned[tab.sessionId];
  };
  let groups = s.groups;
  for (const g of Object.values(s.groups)) {
    const tabs = [...g.tabs.filter(isPinned), ...g.tabs.filter((k) => !isPinned(k))];
    if (tabs.some((k, i) => k !== g.tabs[i])) groups = { ...groups, [g.id]: { ...g, tabs } };
  }
  return groups === s.groups ? s : { ...s, groups };
}

/** Drops a tab on a divider between two panes: a new group is inserted there, as long as the divider is. */
export function dropOnDivider(s: LayoutState, key: string, splitId: string, index: number): LayoutState {
  if (!s.root || !s.tabs[key] || !groupOf(s, key)) return s;
  const id = newGroupId();
  const split: LayoutState = {
    ...s,
    root: insertAtDivider(s.root, splitId, index, id),
    groups: { ...s.groups, [id]: { id, tabs: [], active: '' } }
  };
  return moveTab(split, key, id);
}

/** What dropping `key` on `target` does: the one place that turns a target into a new layout (also used to preview it). */
export function applyDrop(s: LayoutState, key: string, target: DropTarget): LayoutState {
  switch (target.kind) {
    case 'strip': return moveTab(s, key, target.groupId, target.index);
    case 'root': return dropOnRoot(s, key, target.edge);
    case 'divider': return dropOnDivider(s, key, target.splitId, target.index);
    case 'pane': return target.zone === 'center' ? moveTab(s, key, target.groupId) : dropOnEdge(s, key, target.groupId, target.zone);
  }
}

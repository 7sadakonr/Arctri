import { tNow } from '@/lib/i18n';
import { useEditors } from '@/stores/editors';
import { useLayout } from '@/stores/layout';
import { closeSession, openSimilarTab } from '../launcher/actions';
import type { Edge } from './tree';

/** Asks before unsaved edits are thrown away; true when it is fine to go on. */
export function confirmDiscard(keys: string[]): boolean {
  const dirty = useEditors.getState().dirty;
  return !keys.some((k) => dirty[k]) || window.confirm(tNow('viewer.discard'));
}

/** Closes tabs of the grid (a file with unsaved edits asks first). */
export function requestCloseTabs(keys: string[]): void {
  if (!confirmDiscard(keys)) return;
  for (const k of keys) useLayout.getState().close(k);
}

export const requestCloseTab = (key: string): void => requestCloseTabs([key]);

/** Keys of the file tabs of a session that have unsaved edits. */
export function dirtyTabsOf(sessionId: string): string[] {
  const { tabs } = useLayout.getState();
  const dirty = useEditors.getState().dirty;
  return Object.values(tabs)
    .filter((t) => t.kind === 'file' && t.sessionId === sessionId && dirty[t.key])
    .map((t) => t.key);
}

/** Closes what is in front in the focused group: a terminal ends, a file or sidebar just closes. */
export function closeActiveTab(): void {
  const l = useLayout.getState();
  const g = l.focused ? l.groups[l.focused] : undefined;
  const tab = g ? l.tabs[g.active] : undefined;
  if (!tab) return;
  if (tab.kind === 'session') void closeSession(tab.sessionId);
  else requestCloseTab(tab.key);
}

/**
 * Splits the focused group at an edge. With several tabs the front one moves to the new group; with only one, a new
 * terminal of the same kind opens beside it.
 */
export async function splitActive(edge: Edge): Promise<void> {
  const l = useLayout.getState();
  const g = l.focused ? l.groups[l.focused] : undefined;
  if (!g || !l.tabs[g.active]) return;
  if (g.tabs.length > 1) {
    l.drop(g.active, g.id, edge);
    return;
  }
  l.openEmptyGroup(edge);
  try {
    await openSimilarTab();
  } finally {
    useLayout.getState().pruneEmpty();
  }
}

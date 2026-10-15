import type { TabStatus } from './tab-status';

/** What the bell lists, in this order: open requests first, then news. */
export const ATTENTION_SHOWN: TabStatus[] = ['approval', 'waiting', 'finished', 'error'];
/** An approval or a question stays until the agent moves on; opening the tab does not answer it. */
export const ATTENTION_UNRESOLVED: TabStatus[] = ['approval', 'waiting'];

/**
 * Badge numbers. Unresolved items count once each, whether or not they were seen; other updates count only while unread
 * (`unread` is cleared by looking at the tab or "mark all as read", and only a new event sets it again).
 */
export function attentionCounts(rows: Array<{ status: TabStatus; unread: boolean }>): { unresolved: number; unread: number; total: number } {
  const unresolved = rows.filter((r) => ATTENTION_UNRESOLVED.includes(r.status)).length;
  const unread = rows.filter((r) => ATTENTION_SHOWN.includes(r.status) && !ATTENTION_UNRESOLVED.includes(r.status) && r.unread).length;
  return { unresolved, unread, total: unresolved + unread };
}

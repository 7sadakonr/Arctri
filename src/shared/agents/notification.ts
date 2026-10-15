import type { AgentStatus } from '../types/agent-status';

export type NotifyKind = AgentStatus['state'] | 'hint' | 'error';

/**
 * Which OS notification (if any) a status deserves. Only news nobody has seen (`unread`): approvals, questions, finished turns,
 * an abnormal exit, and a bare terminal signal (generic wording). The key names the event itself, so the same event is never
 * announced twice, and a different one is never swallowed because another was announced a moment ago.
 */
export function notificationFor(next: AgentStatus): { key: string; kind: NotifyKind } | null {
  if (!next.unread) return null;
  if (next.state === 'needs-approval' || next.state === 'waiting' || next.state === 'finished') {
    return { key: `${next.state}@${next.since}`, kind: next.state };
  }
  if (next.state === 'exited' && (next.detail?.exitCode ?? 0) !== 0) return { key: `error@${next.since}`, kind: 'error' };
  if (next.state === 'unknown' && next.source === 'terminal-signal') return { key: `hint@${next.timestamp}`, kind: 'hint' };
  return null;
}

/** Remembers the last event announced per tab. Reloading the window or hydrating the store never goes through it. */
export class NotificationLedger {
  private last = new Map<string, string>();

  /** True the first time this event is seen for the tab. */
  claim(sessionId: string, key: string): boolean {
    if (this.last.get(sessionId) === key) return false;
    this.last.set(sessionId, key);
    return true;
  }

  forget(sessionId: string): void {
    this.last.delete(sessionId);
  }
}

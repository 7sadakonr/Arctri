import type { AgentState, AgentStatus, AgentStatusEvent, Confidence } from '../types/agent-status';

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** Only a high-confidence structured source may claim an approval request; anything else is `unknown`. */
export function clampEvent(ev: AgentStatusEvent): AgentStatusEvent {
  if (ev.state === 'needs-approval' && (ev.confidence !== 'high' || ev.source === 'terminal-signal')) {
    return { ...ev, state: 'unknown' };
  }
  return ev;
}

const wantsAttention = (ev: AgentStatusEvent): boolean =>
  ev.state === 'needs-approval' || ev.state === 'waiting' || ev.state === 'finished' || ev.source === 'terminal-signal';

/**
 * Folds one event into the status of a tab. Returns the same object when the event changes nothing.
 * - an event older than the current status is ignored;
 * - `exited` is final;
 * - a weaker source never overrides a known state (a BEL during a hook-driven session adds nothing).
 */
export function reduceStatus(prev: AgentStatus | undefined, raw: AgentStatusEvent, watching: boolean): AgentStatus {
  const ev = clampEvent(raw);
  if (prev) {
    if (ev.timestamp < prev.timestamp || prev.state === 'exited') return prev;
    if (RANK[ev.confidence] < RANK[prev.confidence] && prev.state !== 'unknown' && prev.state !== 'starting') return prev;
  }
  const changed = !prev || prev.state !== ev.state;
  const unread = wantsAttention(ev) && !watching ? true : changed ? false : (prev?.unread ?? false);
  return { ...ev, since: changed ? ev.timestamp : prev!.since, unread };
}

/** The user typed into the tab: a pending approval (or work that was interrupted) is no longer known, so it is not guessed either way. */
export function afterUserInput(prev: AgentStatus, now: number, kind: 'any' | 'interrupt' = 'any'): AgentStatus {
  // Esc / Ctrl+C while it works: Claude Code sends no "stop" event when it is interrupted, so "working" can no longer be vouched for
  const unsure = prev.state === 'needs-approval' || (prev.state === 'working' && kind === 'interrupt');
  if (!unsure) return prev;
  return { ...prev, state: 'unknown', confidence: 'low', since: now, timestamp: now, unread: false };
}

export const STATE_ORDER: AgentState[] = ['needs-approval', 'waiting', 'finished', 'working', 'ready', 'starting', 'unknown', 'exited'];

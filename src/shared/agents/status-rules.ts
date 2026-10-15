import type { AgentState, AgentStatus, AgentStatusEvent, Confidence, StatusReason } from '../types/agent-status';

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** Only a high-confidence structured source may claim an approval request; anything else is `unknown`. */
export function clampEvent(ev: AgentStatusEvent): AgentStatusEvent {
  if (ev.state === 'needs-approval' && (ev.confidence !== 'high' || ev.source === 'terminal-signal')) {
    return { ...ev, state: 'unknown' };
  }
  return ev;
}

const abnormalExit = (ev: AgentStatusEvent): boolean => ev.state === 'exited' && (ev.detail?.exitCode ?? 0) !== 0;

const wantsAttention = (ev: AgentStatusEvent): boolean =>
  ev.state === 'needs-approval' || ev.state === 'waiting' || ev.state === 'finished' || ev.source === 'terminal-signal' || abnormalExit(ev);

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
  const model = ev.model ?? prev?.model; // a model stays known until another one is reported
  return { ...ev, ...(model ? { model } : {}), since: changed ? ev.timestamp : prev!.since, unread };
}

export type UserInputKind = 'interrupt' | 'submit';

/**
 * Two key presses can make the current status untrustworthy; nothing else the user types changes it.
 * - `interrupt` (Esc / Ctrl+C) while it works or asks for approval: Claude Code sends no event when interrupted or when a prompt is
 *   dismissed, so neither state can be vouched for any more. Ordinary typing (arrows, Enter on "Yes", ...) says nothing about whether
 *   an approval was answered: it stays pending until a hook, the process or the tab's agent ending says otherwise.
 * - `submit` (Enter) in a Codex tab that shows `finished`: Codex reports only the end of a turn, so a new turn can start unseen.
 *   The stale `finished` goes to a low-confidence `unknown` (never `working`); the next `agent-turn-complete` sets it again.
 */
export function afterUserInput(prev: AgentStatus, now: number, kind: UserInputKind): AgentStatus {
  let reason: StatusReason | undefined;
  if (kind === 'interrupt' && (prev.state === 'needs-approval' || prev.state === 'working')) reason = 'interrupted';
  else if (kind === 'submit' && prev.agentId === 'codex' && prev.state === 'finished') reason = 'turn-unconfirmed';
  if (!reason) return prev;
  const { detail: _detail, ...rest } = prev;
  return { ...rest, state: 'unknown', confidence: 'low', reason, since: now, timestamp: now, unread: false };
}

export const STATE_ORDER: AgentState[] = ['needs-approval', 'waiting', 'finished', 'working', 'ready', 'starting', 'unknown', 'exited'];

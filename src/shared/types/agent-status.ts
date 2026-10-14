import type { AgentId, SessionId } from './session';

/** `unknown` is the honest answer whenever no trustworthy structured signal exists. */
export type AgentState = 'unknown' | 'starting' | 'ready' | 'working' | 'waiting' | 'needs-approval' | 'finished' | 'exited';
export type StatusSource = 'claude-hook' | 'codex-notify' | 'terminal-signal' | 'pty';
export type Confidence = 'high' | 'medium' | 'low';

export interface AgentStatusEvent {
  /** The Arctri tab. */
  sessionId: SessionId;
  agentId: AgentId;
  /** The CLI's own session or thread id, when it reports one. */
  agentSessionId?: string;
  state: AgentState;
  timestamp: number;
  source: StatusSource;
  confidence: Confidence;
  /** Raw event names only: never prompt text or output. */
  detail?: { event: string; notificationType?: string; tool?: string };
}

export interface AgentStatus extends AgentStatusEvent {
  /** When the state last changed. */
  since: number;
  /** The tab was not on screen when it got here, and nobody has looked at it since. */
  unread: boolean;
}

/** States that ask the user to come back to the tab. */
export const ATTENTION_STATES: readonly AgentState[] = ['needs-approval', 'waiting', 'finished'];

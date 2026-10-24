import type { AgentId, SessionId } from './session';

/** `unknown` is the honest answer whenever no trustworthy structured signal exists. */
export type AgentState = 'unknown' | 'starting' | 'ready' | 'working' | 'waiting' | 'needs-approval' | 'finished' | 'exited';
export type StatusSource = 'claude-hook' | 'codex-notify' | 'terminal-signal' | 'pty';
export type Confidence = 'high' | 'medium' | 'low';
/** Why a state is `unknown` (or unconfirmed): shown in the tooltip, never guessed around. */
export type StatusReason =
  | 'no-hooks-windows' | 'no-hooks-cli' | 'no-hooks-shell' | 'no-events' | 'interrupted' | 'turn-unconfirmed' | 'signal';

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
  detail?: { event: string; notificationType?: string; tool?: string; exitCode?: number };
  reason?: StatusReason;
  /** The model in use, as the agent's own session files say; absent until known. */
  model?: string;
  /** What the agent is doing now (a tool's description or file, or the subject of the prompt it thinks about): goes to the name of the tab, never kept in the status. */
  activity?: string;
  /** Where the agent keeps the transcript of its session (a path as the agent sees it); used to follow `/model`, never kept in the status. */
  transcriptPath?: string;
}

export interface AgentStatus extends AgentStatusEvent {
  /** When the state last changed. */
  since: number;
  /** The tab was not on screen when it got here, and nobody has looked at it since. */
  unread: boolean;
}

/** States that ask the user to come back to the tab. */
export const ATTENTION_STATES: readonly AgentState[] = ['needs-approval', 'waiting', 'finished'];

import type { AgentState } from '../types/agent-status';
import type { SessionInfo, ShellPhase } from '../types/session';

/** What a tab shows. Two models: a plain terminal (starting, ready, running) and an agent (everything else). */
export type TabStatus =
  | 'starting' | 'ready' | 'running'
  | 'working' | 'waiting' | 'approval' | 'finished'
  | 'error' | 'unknown' | 'exited';

type InfoLike = Pick<SessionInfo, 'state' | 'kind' | 'integration'> & { runningAgent?: unknown; exit?: { code: number | null } };

/** True when the tab is run by an agent: a dedicated agent tab, or a shell tab in which one is running. */
export const runsAgent = (info: Pick<SessionInfo, 'kind'> & { runningAgent?: unknown }): boolean => info.kind === 'agent' || !!info.runningAgent;

/**
 * The one place that turns session facts into what a tab shows. Agent states only come from reliable evidence
 * (hooks, the process); with none, an agent tab is `unknown`, never a guess from timing or silence.
 */
export function tabStatus(info: InfoLike, phase: ShellPhase | undefined, agent?: { state: AgentState }): TabStatus {
  if (info.state === 'failed' || (info.state === 'exited' && (info.exit?.code ?? 0) !== 0)) return 'error';
  if (info.state === 'exited') return 'exited';
  if (runsAgent(info)) {
    if (info.state === 'starting') return 'starting';
    switch (agent?.state) {
      case 'starting': return 'starting';
      case 'ready': return 'ready';
      case 'working': return 'working';
      case 'waiting': return 'waiting';
      case 'needs-approval': return 'approval';
      case 'finished': return 'finished';
      default: return 'unknown';
    }
  }
  if (info.state === 'starting' || info.integration === 'pending') return 'starting';
  return phase === 'executing' ? 'running' : 'ready';
}

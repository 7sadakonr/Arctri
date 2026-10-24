import { AGENT_META } from '@shared/agents/meta';
import { tabStatus, type TabStatus } from '@shared/agents/tab-status';
import type { MessageKey } from '@shared/i18n';
import type { AgentStatus } from '@shared/types/agent-status';
import type { SessionInfo } from '@shared/types/session';
import { useAgentStatus } from '@/stores/agent-status';
import { useSessions } from '@/stores/sessions';

export type { TabStatus };

/** The status of one tab, from the same stores everywhere (tab, tooltip, agent bar, bell, palette). */
export function useTabStatus(id: string): {
  info: SessionInfo | undefined;
  /** What is true, on every surface. Looking at a tab only changes `agent.unread`, never the status. */
  status: TabStatus | undefined;
  agent: AgentStatus | undefined;
} {
  const info = useSessions((s) => s.infos[id]);
  const phase = useSessions((s) => s.uiPhase[id]);
  const agent = useAgentStatus((s) => s.byId[id]);
  const status = info ? tabStatus(info, phase, agent) : undefined;
  return { info, agent, status };
}

/**
 * The name a tab goes by: the user's own name wins; else what the agent is doing right now; else the subject of its session
 * (its window title); else the tab's title.
 */
export const tabLabel = (info: Pick<SessionInfo, 'title' | 'titleSource' | 'agentTopic' | 'agentActivity'>): string =>
  info.titleSource === 'user' ? info.title : (info.agentActivity ?? info.agentTopic ?? info.title);

export const stateLabelKey = (s: TabStatus): MessageKey => `agent.state.${s}` as MessageKey;

/** Like `stateLabelKey`, but an unknown caused by a setup that cannot report reads "Status tracking unavailable", not a vague "Unknown". */
export const statusLabelKey = (s: TabStatus, agent?: Pick<AgentStatus, 'reason'>): MessageKey =>
  s === 'unknown' && agent?.reason?.startsWith('no-hooks') ? 'agent.state.unavailable' : stateLabelKey(s);
export const stateHintKey = (s: TabStatus): MessageKey => `agent.stateHint.${s}` as MessageKey;

export const agentName = (id: keyof typeof AGENT_META): string => AGENT_META[id].name;

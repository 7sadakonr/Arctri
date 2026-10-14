import { AGENT_META } from '@shared/agents/meta';
import { tabStatus, type TabStatus } from '@shared/agents/tab-status';
import type { MessageKey } from '@shared/i18n';
import type { AgentStatus } from '@shared/types/agent-status';
import type { SessionInfo } from '@shared/types/session';
import { useAgentStatus } from '@/stores/agent-status';
import { useWindowFocused } from '@/lib/window-focus';
import { useSessions } from '@/stores/sessions';

export type { TabStatus };

/** The status of one tab, from the same stores everywhere (tab, tooltip, agent bar, bell, palette). */
export function useTabStatus(id: string): {
  info: SessionInfo | undefined;
  /** What is true. */
  status: TabStatus | undefined;
  /** What the tab mark shows: a question that is open in the tab in front of you looks like the normal ready state (you are looking at it). */
  shown: TabStatus | undefined;
  agent: AgentStatus | undefined;
} {
  const info = useSessions((s) => s.infos[id]);
  const phase = useSessions((s) => s.uiPhase[id]);
  const agent = useAgentStatus((s) => s.byId[id]);
  const inFront = useSessions((s) => s.activeId === id);
  const focused = useWindowFocused();
  const viewed = inFront && focused;
  const status = info ? tabStatus(info, phase, agent) : undefined;
  return { info, agent, status, shown: status === 'waiting' && viewed ? 'ready' : status };
}

/** The name a tab goes by: the user's own name wins; else what the agent says it is working on; else the tab's title. */
export const tabLabel = (info: Pick<SessionInfo, 'title' | 'titleSource' | 'agentTopic'>): string =>
  info.titleSource !== 'user' && info.agentTopic ? info.agentTopic : info.title;

export const stateLabelKey = (s: TabStatus): MessageKey => `agent.state.${s}` as MessageKey;
export const stateHintKey = (s: TabStatus): MessageKey => `agent.stateHint.${s}` as MessageKey;

export const agentName = (id: keyof typeof AGENT_META): string => AGENT_META[id].name;

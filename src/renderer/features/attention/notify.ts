import { AGENT_META } from '@shared/agents/meta';
import type { AgentStatus } from '@shared/types/agent-status';
import { api } from '@/lib/api';
import { tNow } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { tabLabel } from './status-view';

const lastAt = new Map<string, number>();

/** Raises an operating-system notification when a tab that nobody is looking at newly needs the user (at most one per tab every 10 s). */
export function notifyStatus(prev: AgentStatus | undefined, next: AgentStatus): void {
  if (!next.unread || (prev?.unread && prev.state === next.state)) return;
  const attentionState = next.state === 'needs-approval' || next.state === 'waiting' || next.state === 'finished';
  const hint = next.state === 'unknown' && next.source === 'terminal-signal';
  if (!attentionState && !hint) return;
  if (!useUi.getState().prefs.agentNotifications) return;
  const now = Date.now();
  if (now - (lastAt.get(next.sessionId) ?? 0) < 10_000) return;
  lastAt.set(next.sessionId, now);
  const info = useSessions.getState().infos[next.sessionId];
  const title = info ? tabLabel(info) : AGENT_META[next.agentId].name;
  const body = hint ? tNow('agent.needsAttention') : `${AGENT_META[next.agentId].name}: ${tNow(`agent.state.${next.state}` as 'agent.state.waiting')}`;
  void api.app.notify(next.sessionId, title, body);
}

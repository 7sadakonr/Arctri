import { AGENT_META } from '@shared/agents/meta';
import { NotificationLedger, notificationFor } from '@shared/agents/notification';
import type { AgentStatus } from '@shared/types/agent-status';
import { api } from '@/lib/api';
import { tNow } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { tabLabel } from './status-view';

const ledger = new NotificationLedger();

/** Forget a closed tab's last announcement. */
export const forgetNotified = (id: string): void => ledger.forget(id);

/**
 * Raises an operating-system notification when a tab that nobody is looking at has a new event that needs the user.
 * Identity is the event (state + when it began), not a time window. Text is the tab name, the agent and the state: never output.
 */
export function notifyStatus(_prev: AgentStatus | undefined, next: AgentStatus): void {
  const n = notificationFor(next);
  if (!n || !ledger.claim(next.sessionId, n.key)) return;
  if (!useUi.getState().prefs.agentNotifications) return;
  const info = useSessions.getState().infos[next.sessionId];
  const title = info ? tabLabel(info) : AGENT_META[next.agentId].name;
  const name = AGENT_META[next.agentId].name;
  const body =
    n.kind === 'hint' ? tNow('agent.needsAttention')
    : n.kind === 'error' ? `${name}: ${tNow('agent.state.error')}`
    : `${name}: ${tNow(`agent.state.${n.kind}` as 'agent.state.waiting')}`;
  void api.app.notify(next.sessionId, title, body);
}

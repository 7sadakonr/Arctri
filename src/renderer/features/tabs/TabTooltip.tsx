import { AGENT_META } from '@shared/agents/meta';
import type { MessageKey } from '@shared/i18n';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { formatElapsed } from '@/lib/elapsed';
import { statusLabelKey, tabLabel, useTabStatus } from '../attention/status-view';

/** The compact status card of a tab. Only mounted while the tooltip is open, so its clock runs only then. */
export function TabTooltip({ id }: { id: string }) {
  const t = useT();
  const { info, status, agent } = useTabStatus(id);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!info || !status) return null;

  const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
  const heading = agentId ? AGENT_META[agentId].name : info.title.split(' · ')[0];
  const live = agent && status !== 'exited' && status !== 'error' && status !== 'starting';
  let note: string | undefined;
  if (status === 'approval') note = t('tooltip.actionInTerminal');
  else if (agentId && (status === 'unknown' || status === 'starting')) {
    note = agent?.reason ? t(`tooltip.reason.${agent.reason}` as MessageKey) : t('tooltip.noEventsYet');
  }

  return (
    <div className="space-y-0.5" data-testid="tab-tooltip">
      <div className="font-medium">{heading}</div>
      <div>{t('tooltip.status', { state: t(statusLabelKey(status, agent)) })}</div>
      {agentId && <div>{t('tooltip.session', { name: tabLabel(info) })}</div>}
      {agentId && tabLabel(info) !== info.title && <div className="text-fg-muted">{info.agentTopic && info.agentTopic !== tabLabel(info) ? info.agentTopic : info.title}</div>}
      {live && agent && <div>{t('tooltip.elapsed', { time: formatElapsed(now - agent.since) })}</div>}
      {note && <div className="text-fg-muted">{note}</div>}
      {agentId === 'codex' && status !== 'unknown' && status !== 'starting' && <div className="text-fg-muted">{t('tooltip.codexLimit')}</div>}
      {agent && agent.source !== 'pty' && (
        <div className="text-[10px] text-fg-muted">
          {t('tooltip.source', {
            source: t(`agent.source.${agent.source}` as MessageKey),
            confidence: t(`agent.confidence.${agent.confidence}` as MessageKey)
          })}
        </div>
      )}
    </div>
  );
}

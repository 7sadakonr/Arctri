import { AGENT_META } from '@shared/agents/meta';
import { runsAgent, tabStatus, type TabStatus } from '@shared/agents/tab-status';
import { Bell, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { focusActiveSession } from '@/lib/focus';
import { useLang, useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/relative-time';
import { useAgentStatus } from '@/stores/agent-status';
import { useSessions } from '@/stores/sessions';
import { StatusIndicator } from './StatusIndicator';
import { stateLabelKey, tabLabel } from './status-view';

const SHOWN: TabStatus[] = ['approval', 'waiting', 'finished', 'error'];
/** An approval or a question stays until the agent moves on; opening the tab does not answer it. */
const UNRESOLVED: TabStatus[] = ['approval', 'waiting'];

const projectOf = (path: string | undefined): string => (path ? path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path : '');

/** The bell at the right of the tab bar: the agents that need the user, one click from their terminal. */
export function AttentionCenter() {
  const t = useT();
  const lang = useLang();
  const byId = useAgentStatus((s) => s.byId);
  const infos = useSessions((s) => s.infos);
  const order = useSessions((s) => s.order);
  const uiPhase = useSessions((s) => s.uiPhase);
  const activeId = useSessions((s) => s.activeId);

  const rows = order
    .flatMap((id) => {
      const info = infos[id];
      if (!info || !runsAgent(info)) return [];
      const agent = byId[id];
      const status = tabStatus(info, uiPhase[id], agent);
      if (!SHOWN.includes(status)) return [];
      const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
      return [{ id, info, status, agent, since: agent?.since ?? info.createdAt, name: agentId ? AGENT_META[agentId].name : '' }];
    })
    .sort((a, b) => SHOWN.indexOf(a.status) - SHOWN.indexOf(b.status) || b.since - a.since);

  const unresolved = rows.filter((r) => UNRESOLVED.includes(r.status)).length;
  // unread: news nobody has looked at yet (a finished turn, a failure in a tab that is not in front)
  const unread = rows.filter((r) => !UNRESOLVED.includes(r.status) && (r.agent?.unread || (r.status === 'error' && r.id !== activeId))).length;
  const count = unresolved + unread;
  const Icon = unresolved > 0 ? BellRing : Bell;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('attention.title')} title={t('attention.title')} data-testid="attention-button" className="relative">
          <Icon size={14} />
          {count > 0 && (
            <span
              data-testid="attention-badge"
              data-unresolved={unresolved}
              data-unread={unread}
              className={cn(
                'absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold text-white',
                unresolved > 0 ? 'bg-orange-500' : 'bg-accent'
              )}
            >
              {count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel>{t('attention.title')}</DropdownMenuLabel>
        {rows.length === 0 && <div className="px-2 py-3 text-fg-muted">{t('attention.empty')}</div>}
        {rows.map((r) => (
          <DropdownMenuItem
            key={r.id}
            data-testid={`attention-row-${r.status}`}
            onSelect={() => {
              useSessions.getState().setActive(r.id);
              focusActiveSession();
            }}
          >
            <StatusIndicator status={r.status} unread={!!r.agent?.unread} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{tabLabel(r.info)}</span>
              <span className="block truncate text-[10px] text-fg-muted">
                {[r.name, projectOf(r.info.cwd?.path), t(stateLabelKey(r.status))].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className={cn('shrink-0 text-[10px] text-fg-muted', r.agent?.unread && 'font-semibold text-fg')}>{relativeTime(r.since / 1000, lang)}</span>
          </DropdownMenuItem>
        ))}
        {rows.some((r) => r.status === 'approval') && <div className="px-2 pb-1 pt-2 text-[10px] text-fg-muted">{t('attention.hint')}</div>}
        {rows.some((r) => r.agent?.unread) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void api.agentStatus.markRead('all')}>{t('attention.markAll')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

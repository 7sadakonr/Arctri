import { ChevronDown, ChevronsRight, PanelRight, Pin, Plus, SquareTerminal, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { toggleSidebar } from '../sidebar/toggle';
import { closeSession, openSimilarTab } from '../launcher/actions';
import { NewTabMenu } from '../launcher/NewTabMenu';
import { AttentionCenter } from '../attention/AttentionCenter';
import { StatusIndicator } from '../attention/StatusIndicator';
import { tabLabel, useTabStatus } from '../attention/status-view';
import { TabTooltip } from './TabTooltip';
import { AgentLogo } from '../agents/AgentLogo';
import { splitTabs } from './split-tabs';

/** The logo of the agent in a tab, or the terminal icon: always in front of the name. */
function TabIcon({ id }: { id: string }) {
  const info = useSessions((s) => s.infos[id]);
  if (!info) return null;
  const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
  return agentId ? <AgentLogo agent={agentId} /> : <SquareTerminal size={13} className="shrink-0 opacity-70" />;
}

/** The status of a tab, after its name (a fixed 14 px box, so it never moves the name). */
function TabStatusMark({ id }: { id: string }) {
  const { status, agent } = useTabStatus(id);
  return status ? <StatusIndicator status={status} unread={!!agent?.unread} /> : null;
}

function Tab({ id, index }: { id: string; index: number }) {
  const info = useSessions((s) => s.infos[id]);
  const active = useSessions((s) => s.activeId === id);
  const t = useT();
  const pinned = useSessions((s) => !!s.pinned[id]);
  const { status } = useTabStatus(id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  // F2 renames the active tab (dispatched from the global key handler).
  useEffect(() => {
    if (!active) return;
    const h = () => {
      setDraft(info ? tabLabel(info) : '');
      setEditing(true);
    };
    window.addEventListener('arctri:rename-tab', h);
    return () => window.removeEventListener('arctri:rename-tab', h);
  }, [active, info]);

  if (!info) return null;
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== tabLabel(info)) void api.sessions.rename(id, draft);
  };
  return (
    <Tip label={<TabTooltip id={id} />} side="bottom">
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      draggable={!editing}
      onClick={() => !editing && focusActiveSession()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const sibling = (dir: 'nextElementSibling' | 'previousElementSibling') => {
          const el = e.currentTarget[dir] as HTMLElement | null;
          if (el?.getAttribute('role') === 'tab') el.focus();
        };
        if (e.key === 'ArrowRight') sibling('nextElementSibling');
        else if (e.key === 'ArrowLeft') sibling('previousElementSibling');
        else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          useSessions.getState().setActive(id);
          focusActiveSession();
        }
      }}
      onDragStart={(e) => e.dataTransfer.setData('text/arctri-tab', String(index))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const from = Number(e.dataTransfer.getData('text/arctri-tab'));
        if (Number.isInteger(from)) useSessions.getState().move(from, index);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          if (!pinned) void closeSession(id);
        } else useSessions.getState().setActive(id);
      }}
      onDoubleClick={() => {
        setDraft(tabLabel(info));
        setEditing(true);
      }}
      className={cn(
        // square tabs divided by thin lines, as in Zed; the active one is the colour of the terminal and open to it below
        'no-drag group relative flex h-full items-center gap-1.5 border-r border-border text-xs transition-colors',
        pinned ? 'w-10 shrink-0 justify-center px-0' : 'min-w-[110px] max-w-[220px] flex-1 px-3',
        active
          ? 'bg-bg text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-bg'
          : 'text-fg-muted hover:bg-hover hover:text-fg',
        'focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-accent'
      )}
    >
      <TabIcon id={id} />
      {pinned ? null : editing ? (
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
            e.stopPropagation();
          }}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{tabLabel(info)}</span>
      )}
      {!pinned && status === 'approval' && (
        <span data-testid="tab-approval" className="shrink-0 rounded bg-yellow-400/20 px-1 text-[10px] font-medium text-yellow-500">
          {t('tab.approval')}
        </span>
      )}
      <TabStatusMark id={id} />
      {!pinned && (
        <Tip label={t('tab.pin')} side="bottom">
          <button
            aria-label={t('tab.pin')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => useSessions.getState().togglePin(id)}
            className="rounded p-0.5 opacity-0 hover:bg-border group-hover:opacity-70"
          >
            <Pin size={11} />
          </button>
        </Tip>
      )}
      {!pinned && (
        <Tip label={t('tab.close')} side="bottom">
          <button
            aria-label={t('tab.close')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void closeSession(id)}
            className={cn('rounded p-0.5 hover:bg-border', active ? 'opacity-70' : 'opacity-0 group-hover:opacity-70')}
          >
            <X size={12} />
          </button>
        </Tip>
      )}
    </div>
    </Tip>
  );
}

function OverflowMenu({ ids }: { ids: string[] }) {
  const t = useT();
  const infos = useSessions((s) => s.infos);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('tab.overflow')} title={t('tab.overflow')} data-testid="tab-overflow" className="no-drag relative">
          <ChevronsRight size={14} />
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-border px-1 text-[9px] text-fg">{ids.length}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
        {ids.map((id) => (
          <DropdownMenuItem
            key={id}
            onSelect={() => {
              useSessions.getState().setActive(id);
              focusActiveSession();
            }}
          >
            <TabIcon id={id} />
            <span className="min-w-0 flex-1 truncate">{infos[id] ? tabLabel(infos[id]!) : ''}</span>
            <TabStatusMark id={id} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TabBar() {
  const order = useSessions((s) => s.order);
  const pinned = useSessions((s) => s.pinned);
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const activeId = useSessions((s) => s.activeId);
  const hasFolder = useSessions((s) => !!(s.activeId && s.infos[s.activeId]?.cwd));
  const filesOpen = useUi((s) => s.prefs.sidebarOpen);
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [order.length > 0]);

  if (order.length === 0) return null;
  const { shown, hidden } = splitTabs(order, pinned, activeId, width);

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-panel">
      <div ref={listRef} role="tablist" className="flex min-w-0 flex-1 items-stretch">
        {shown.map((id) => (
          <Tab key={id} id={id} index={order.indexOf(id)} />
        ))}
        <div className="no-drag flex shrink-0 items-center px-1">
          {hidden.length > 0 && <OverflowMenu ids={hidden} />}
          <Tip label={t('tab.new')} side="bottom">
            <Button variant="ghost" size="icon" aria-label={t('tab.new')} onClick={() => void openSimilarTab()}>
              <Plus size={14} />
            </Button>
          </Tip>
          <NewTabMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <Button variant="ghost" size="icon" aria-label={t('tab.new')} className="-ml-1 w-4">
              <ChevronDown size={12} />
            </Button>
          </NewTabMenu>
        </div>
      </div>
      <div className="no-drag flex shrink-0 items-center gap-0.5 border-l border-border px-1">
        <AttentionCenter />
        {activeId && hasFolder && (
          <Tip label={t('agent.filesHint')} side="bottom">
            <Button
              variant={filesOpen ? 'outline' : 'ghost'}
              size="icon"
              aria-label={t('agent.files')}
              aria-pressed={filesOpen}
              onClick={() => {
                toggleSidebar();
                focusActiveSession();
              }}
            >
              <PanelRight size={14} />
            </Button>
          </Tip>
        )}
      </div>
    </div>
  );
}

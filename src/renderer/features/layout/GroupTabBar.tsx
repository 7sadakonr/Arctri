import { ChevronDown, ChevronsRight, Maximize2, Minimize2, Pin, Plus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TerminalIcon } from '@/components/TerminalIcon';
import { Button } from '@/components/ui/button';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger
} from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { copyText } from '@/lib/clipboard';
import { focusActiveSession } from '@/lib/focus';
import { iconUrl } from '@/lib/file-icon';
import { useT } from '@/lib/i18n';
import { isMac, kbd } from '@/lib/platform';
import { useEditors } from '@/stores/editors';
import { useLayout, type Group, type TabRef } from '@/stores/layout';
import { useSessions } from '@/stores/sessions';
import { AgentLogo } from '../agents/AgentLogo';
import { tabLabel, useTabStatus } from '../attention/status-view';
import { StatusIndicator } from '../attention/StatusIndicator';
import { closeSession, duplicateSession, openSimilarTab, restartSession } from '../launcher/actions';
import { NewTabMenu } from '../launcher/NewTabMenu';
import { splitTabs } from '../tabs/split-tabs';
import { TabTooltip } from '../tabs/TabTooltip';
import { startTabDrag, useDrag } from './dnd';
import { tabLabelOf } from './labels';
import { requestCloseTab, requestCloseTabs } from './actions';
import { siblingsOf } from './model';

const baseName = (rel: string) => rel.replace(/\\/g, '/').split('/').at(-1) ?? rel;

/** The logo of the agent in a tab, or the terminal icon: always in front of the name. */
function SessionIcon({ id }: { id: string }) {
  const info = useSessions((s) => s.infos[id]);
  if (!info) return null;
  const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
  return agentId ? <AgentLogo agent={agentId} /> : <TerminalIcon size={16} />;
}

function TabIcon({ tab }: { tab: TabRef }) {
  if (tab.kind === 'session') return <SessionIcon id={tab.sessionId} />;
  return <img src={iconUrl(baseName(tab.path ?? tab.rel), false)} alt="" width={14} height={14} draggable={false} className="shrink-0" />;
}

/** The status of a tab, after its name (a fixed 14 px box, so it never moves the name). */
function TabStatusMark({ id }: { id: string }) {
  const { status, agent } = useTabStatus(id);
  return status ? <StatusIndicator status={status} unread={!!agent?.unread} /> : null;
}

function useTabLabel(tab: TabRef): string {
  const info = useSessions((s) => s.infos[tab.sessionId]);
  return tabLabelOf(tab, info);
}

function Tab({ tab, group, index }: { tab: TabRef; group: Group; index: number }) {
  const key = tab.key;
  const sid = tab.sessionId;
  const info = useSessions((s) => s.infos[sid]);
  const active = group.active === key;
  const focusedHere = useLayout((s) => s.focused === group.id);
  const t = useT();
  const pinned = useSessions((s) => tab.kind === 'session' && !!s.pinned[sid]);
  const dirty = useEditors((s) => !!s.dirty[key]);
  const label = useTabLabel(tab);
  const { status } = useTabStatus(sid);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // while a tab is dragged it fades (the preview over the window shows where it is going)
  const beingDragged = useDrag((s) => s.key === key);
  const input = useRef<HTMLInputElement>(null);
  const isSession = tab.kind === 'session';

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  // F2 renames the tab in front (dispatched from the global key handler)
  useEffect(() => {
    if (!isSession || !active || !focusedHere) return;
    const h = () => {
      setDraft(info ? tabLabel(info) : '');
      setEditing(true);
    };
    window.addEventListener('arctri:rename-tab', h);
    return () => window.removeEventListener('arctri:rename-tab', h);
  }, [isSession, active, focusedHere, info]);

  if (!info) return null;
  const closeThis = () => (isSession ? void closeSession(sid) : requestCloseTab(key));
  const startRename = () => {
    setDraft(tabLabel(info));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== tabLabel(info)) void api.sessions.rename(sid, draft);
  };
  const layout = useLayout.getState;
  const dragging = useDrag.getState;

  return (
    <ContextMenu onOpenChange={(open) => open && layout().activate(key)}>
      <Tip label={isSession ? <TabTooltip id={sid} /> : label} side="bottom">
        <ContextMenuTrigger asChild>
          <div
            role="tab"
            data-tab-key={key}
            data-tab-kind={tab.kind}
            data-tab-index={index}
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
                layout().activate(key);
                focusActiveSession();
              }
            }}
            onDragStart={(e) =>
              startTabDrag(e, { key, sourceGroup: group.id, sourceAlone: group.tabs.length === 1, groupCount: Object.keys(layout().groups).length }, label)
            }
            onDragEnd={() => dragging().end()}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                if (!pinned) closeThis();
              } else layout().activate(key);
            }}
            onDoubleClick={() => {
              if (isSession) startRename();
              else if (tab.kind === 'file') layout().pinFile(key);
            }}
            className={cn(
              // square tabs divided by thin lines, as in Zed; the active one is the colour of the content and open to it below
              'no-drag group relative flex h-full items-center gap-1.5 border-r border-border text-xs transition-colors',
              'min-w-[110px] max-w-[220px] flex-1 px-3',
              active
                ? cn('bg-bg after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-bg', focusedHere ? 'text-fg' : 'text-fg-muted')
                : 'text-fg-muted hover:bg-hover hover:text-fg',
              beingDragged && 'opacity-40',
              'focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-accent'
            )}
          >
            <TabIcon tab={tab} />
            {editing ? (
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
              <span className={cn('min-w-0 flex-1 truncate', tab.kind === 'file' && tab.preview && 'italic')}>{label}</span>
            )}
            {isSession && status === 'approval' && (
              <span data-testid="tab-approval" className="shrink-0 rounded bg-yellow-400/20 px-1 text-[10px] font-medium text-yellow-500">
                {t('tab.approval')}
              </span>
            )}
            {isSession && <TabStatusMark id={sid} />}
            {dirty && <span className="shrink-0 text-warn">●</span>}
            {pinned ? (
              <Tip label={t('tab.unpin')} side="bottom">
                <button
                  aria-label={t('tab.unpin')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => useSessions.getState().togglePin(sid)}
                  className="rounded p-0.5 opacity-70 hover:bg-border hover:opacity-100"
                >
                  <Pin size={12} fill="currentColor" />
                </button>
              </Tip>
            ) : (
              <Tip label={t('tab.close')} side="bottom">
                <button
                  aria-label={t('tab.close')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={closeThis}
                  className={cn('rounded p-0.5 hover:bg-border', active ? 'opacity-70' : 'opacity-0 group-hover:opacity-70')}
                >
                  <X size={12} />
                </button>
              </Tip>
            )}
          </div>
        </ContextMenuTrigger>
      </Tip>
      <ContextMenuContent onCloseAutoFocus={(e) => { e.preventDefault(); focusActiveSession(); }}>
        {isSession && (
          <>
            <ContextMenuItem onSelect={() => void duplicateSession(info)}>{t('tab.duplicate')}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => useSessions.getState().togglePin(sid)}>{pinned ? t('tab.unpin') : t('tab.pin')}</ContextMenuItem>
            <ContextMenuItem onSelect={startRename}>
              {t('menu.renameTab')}
              <ContextMenuShortcut>F2</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void restartSession(info)}>{t('menu.restart')}</ContextMenuItem>
            {info.cwd && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => void copyText(info.cwd!.path)}>{t('tab.copyPath')}</ContextMenuItem>
                <ContextMenuItem onSelect={() => void api.app.openPath(sid)}>{t(isMac ? 'menu.showFolderMac' : 'menu.showFolder')}</ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => layout().drop(key, group.id, 'right')} disabled={group.tabs.length < 2}>{t('pane.splitRight')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => layout().drop(key, group.id, 'bottom')} disabled={group.tabs.length < 2}>{t('pane.splitDown')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={closeThis}>
          {t('tab.close')}
          {isSession && <ContextMenuShortcut>{kbd('Ctrl+Shift+W')}</ContextMenuShortcut>}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => closeKeys(siblingsOf(layout(), key, 'others'))}>{t('tab.closeOthers')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => closeKeys(siblingsOf(layout(), key, 'right'))}>{t('tab.closeRight')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Closes tabs of a group: sessions end (pinned ones stay), files ask first when they have unsaved edits. */
function closeKeys(keys: string[]): void {
  const { tabs } = useLayout.getState();
  const { pinned } = useSessions.getState();
  const files: string[] = [];
  for (const k of keys) {
    const tab = tabs[k];
    if (!tab) continue;
    if (tab.kind === 'session') {
      if (!pinned[tab.sessionId]) void closeSession(tab.sessionId);
    } else files.push(k);
  }
  requestCloseTabs(files);
}

function OverflowMenu({ keys }: { keys: string[] }) {
  const t = useT();
  const tabs = useLayout((s) => s.tabs);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('tab.overflow')} title={t('tab.overflow')} data-testid="tab-overflow" className="no-drag relative">
          <ChevronsRight size={14} />
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-border px-1 text-[9px] text-fg">{keys.length}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
        {keys.map((k) => {
          const tab = tabs[k];
          return tab ? <OverflowItem key={k} tab={tab} /> : null;
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OverflowItem({ tab }: { tab: TabRef }) {
  const label = useTabLabel(tab);
  return (
    <DropdownMenuItem
      onSelect={() => {
        useLayout.getState().activate(tab.key);
        focusActiveSession();
      }}
    >
      <TabIcon tab={tab} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {tab.kind === 'session' && <TabStatusMark id={tab.sessionId} />}
    </DropdownMenuItem>
  );
}

/** The tab strip of one group: its tabs, a button for a new terminal here, and the zoom of the group. */
export function GroupTabBar({ group }: { group: Group }) {
  const t = useT();
  const pinnedSessions = useSessions((s) => s.pinned);
  const tabs = useLayout((s) => s.tabs);
  const many = useLayout((s) => Object.keys(s.groups).length > 1);
  const zoomed = useLayout((s) => s.zoomed === group.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pinned: Record<string, boolean> = {};
  for (const k of group.tabs) {
    const tab = tabs[k];
    if (tab?.kind === 'session' && pinnedSessions[tab.sessionId]) pinned[k] = true;
  }
  const { shown, hidden } = splitTabs(group.tabs, pinned, group.active, width);

  return (
    <div data-testid="group-tabbar" data-group-strip={group.id} className="flex h-9 shrink-0 items-stretch border-b border-border bg-panel">
      <div ref={listRef} role="tablist" className="flex min-w-0 flex-1 items-stretch">
        {shown.map((k) => {
          const tab = tabs[k];
          return tab ? <Tab key={k} tab={tab} group={group} index={group.tabs.indexOf(k)} /> : null;
        })}
        <div className="no-drag flex shrink-0 items-center px-1">
          {hidden.length > 0 && <OverflowMenu keys={hidden} />}
          <Tip label={t('tab.new')} side="bottom">
            <Button variant="ghost" size="icon" aria-label={t('tab.new')} onClick={() => { useLayout.getState().focus(group.id); void openSimilarTab(); }}>
              <Plus size={14} />
            </Button>
          </Tip>
          <NewTabMenu open={menuOpen} onOpenChange={(o) => { if (o) useLayout.getState().focus(group.id); setMenuOpen(o); }}>
            <Button variant="ghost" size="icon" aria-label={t('tab.new')} className="-ml-1 w-4">
              <ChevronDown size={12} />
            </Button>
          </NewTabMenu>
        </div>
      </div>
      {(many || zoomed) && (
        <div className="no-drag flex shrink-0 items-center border-l border-border px-1">
          <Tip label={t(zoomed ? 'pane.restore' : 'pane.zoom')} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              data-testid="pane-zoom"
              aria-label={t(zoomed ? 'pane.restore' : 'pane.zoom')}
              aria-pressed={zoomed}
              onClick={() => useLayout.getState().zoom(group.id)}
            >
              {zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </Button>
          </Tip>
        </div>
      )}
    </div>
  );
}

import { Bot, ChevronDown, Plus, SquareTerminal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { closeSession, openSimilarTab } from '../launcher/actions';
import { NewTabMenu } from '../launcher/NewTabMenu';

function StatusDot({ id }: { id: string }) {
  const info = useSessions((s) => s.infos[id]);
  const phase = useSessions((s) => s.uiPhase[id]);
  if (!info) return null;
  const color =
    info.state === 'failed' || (info.state === 'exited' && (info.exit?.code ?? 0) !== 0)
      ? 'bg-danger'
      : info.state === 'exited'
        ? 'bg-fg-muted'
        : phase === 'executing'
          ? 'bg-warn animate-pulse'
          : 'bg-ok';
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', color)} />;
}

function Tab({ id, index }: { id: string; index: number }) {
  const info = useSessions((s) => s.infos[id]);
  const active = useSessions((s) => s.activeId === id);
  const t = useT();
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
      setDraft(info?.title ?? '');
      setEditing(true);
    };
    window.addEventListener('agentdock:rename-tab', h);
    return () => window.removeEventListener('agentdock:rename-tab', h);
  }, [active, info?.title]);

  if (!info) return null;
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== info.title) void api.sessions.rename(id, draft);
  };
  const Icon = info.kind === 'agent' ? Bot : SquareTerminal;

  return (
    <div
      role="tab"
      aria-selected={active}
      draggable={!editing}
      onDragStart={(e) => e.dataTransfer.setData('text/agentdock-tab', String(index))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const from = Number(e.dataTransfer.getData('text/agentdock-tab'));
        if (Number.isInteger(from)) useSessions.getState().move(from, index);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          void closeSession(id);
        } else useSessions.getState().setActive(id);
      }}
      onDoubleClick={() => {
        setDraft(info.title);
        setEditing(true);
      }}
      className={cn(
        'no-drag group relative flex h-7 min-w-[110px] max-w-[220px] flex-1 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
        active ? 'bg-panel text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
      )}
    >
      <StatusDot id={id} />
      <Icon size={13} className="shrink-0 opacity-70" />
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
        <span className="min-w-0 flex-1 truncate" title={info.title}>
          {info.title}
        </span>
      )}
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
    </div>
  );
}

export function TabBar() {
  const order = useSessions((s) => s.order);
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="drag fixed z-30 flex items-center gap-1 pl-2"
      style={{
        left: 'env(titlebar-area-x, 0px)',
        top: 0,
        width: 'env(titlebar-area-width, 100%)',
        height: 'env(titlebar-area-height, 36px)'
      }}
    >
      <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1">
        {order.map((id, i) => (
          <Tab key={id} id={id} index={i} />
        ))}
        <div className="no-drag flex shrink-0 items-center">
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
    </div>
  );
}

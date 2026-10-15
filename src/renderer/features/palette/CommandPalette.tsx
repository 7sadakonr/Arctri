import { AGENT_META } from '@shared/agents/meta';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { useAgentStatus } from '@/stores/agent-status';
import { useSessions } from '@/stores/sessions';
import { COMMANDS, OPEN_PALETTE_EVENT, commandCtx, commandShortcut, commandTitle, isEnabled, runCommand, type Command } from '@/commands/registry';
import { filterRanked } from '@/commands/filter';
import { runsAgent, tabStatus, type TabStatus } from '@shared/agents/tab-status';
import { StatusIndicator } from '../attention/StatusIndicator';
import { statusLabelKey, tabLabel } from '../attention/status-view';

type Row =
  | { kind: 'command'; command: Command; title: string }
  | { kind: 'session'; id: string; title: string; detail: string; display: TabStatus | null };

/** Ctrl+Shift+P: every command of the app, and a search over the open sessions (by name, agent, folder or state). */
export function CommandPalette() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'all' | 'tabs'>('all');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const infos = useSessions((s) => s.infos);
  const order = useSessions((s) => s.order);
  const statuses = useAgentStatus((s) => s.byId);

  useEffect(() => {
    const h = (e: Event) => {
      setMode((e as CustomEvent).detail === 'tabs' ? 'tabs' : 'all');
      setQuery('');
      setCursor(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_PALETTE_EVENT, h);
    return () => window.removeEventListener(OPEN_PALETTE_EVENT, h);
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (!open) return [];
    const ctx = commandCtx();
    const commands = mode === 'tabs' ? [] : COMMANDS.filter((c) => !c.hidden && isEnabled(c, ctx));
    const cmdRows = filterRanked(
      commands.map((c) => ({ item: c, fields: [t(commandTitle(c)), c.keywords ?? ''] })),
      query
    ).map((c): Row => ({ kind: 'command', command: c, title: t(commandTitle(c)) }));

    const sessions = order.flatMap((id) => {
      const info = infos[id];
      if (!info) return [];
      const st = statuses[id];
      const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
      const agent = agentId ? AGENT_META[agentId].name : '';
      const shown = runsAgent(info) ? tabStatus(info, undefined, st) : null;
      const state = shown ? t(statusLabelKey(shown, st)) : '';
      const detail = [agent, state, info.cwd?.path].filter(Boolean).join(' · ');
      return [{
        item: { kind: 'session', id, title: tabLabel(info), detail, display: runsAgent(info) ? tabStatus(info, undefined, st) : null } as Row,
        fields: [tabLabel(info), info.title, agent, state, info.cwd?.path ?? '', info.gitBranch ?? '']
      }];
    });
    // sessions only join the command list once something is typed, so the empty palette stays a list of commands
    const sesRows = mode === 'tabs' || query.trim() ? filterRanked(sessions, query) : [];
    return mode === 'tabs' ? sesRows : [...cmdRows, ...sesRows];
  }, [open, mode, query, order, infos, statuses, t]);

  useEffect(() => setCursor(0), [query, mode]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    setOpen(false);
    // after the dialog has given the focus back
    setTimeout(() => {
      if (row.kind === 'session') useSessions.getState().setActive(row.id);
      else runCommand(row.command);
      focusActiveSession();
    }, 0);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        title={mode === 'tabs' ? t('cmd.findSession') : t('cmd.palette')}
        closeLabel={t('common.close')}
        className="top-[18%] -translate-y-0"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActiveSession();
        }}
      >
        <input
          ref={input}
          value={query}
          data-testid="palette-input"
          placeholder={t(mode === 'tabs' ? 'palette.placeholderTabs' : 'palette.placeholder')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return; // Thai and other IME input: Enter confirms the text first
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(rows[cursor]);
            }
          }}
          className="mb-2 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div role="listbox" className="max-h-[50vh] overflow-auto" data-testid="palette-list">
          {rows.length === 0 && <div className="px-2 py-3 text-xs text-fg-muted">{t('palette.empty')}</div>}
          {rows.map((r, i) => (
            <div
              key={r.kind === 'command' ? `c:${r.command.id}` : `s:${r.id}`}
              role="option"
              aria-selected={i === cursor}
              data-testid={r.kind === 'command' ? `palette-cmd-${r.command.id}` : `palette-session-${r.id}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => choose(r)}
              className={cn('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-xs', i === cursor && 'bg-hover')}
            >
              {r.kind === 'session' && r.display && <StatusIndicator status={r.display} size={13} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.title}</span>
                {r.kind === 'session' && r.detail && <span className="block truncate text-[10px] text-fg-muted" dir="auto">{r.detail}</span>}
              </span>
              {r.kind === 'command' && commandShortcut(r.command) && (
                <span className="shrink-0 font-mono text-[10px] text-fg-muted">{commandShortcut(r.command)}</span>
              )}
              {r.kind === 'session' && <span className="shrink-0 text-[10px] text-fg-muted">{t('palette.session')}</span>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { ChevronRight, FileDiff, FolderTree, GitBranch, History } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import type { SessionInfo } from '@shared/types/session';
import type { Prefs } from '@shared/prefs';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@shared/i18n';
import { useUi } from '@/stores/ui';
import { useChanges } from '../agents/useChanges';
import { BranchesView } from './BranchesView';
import { ChangesView } from './ChangesView';
import { FilesView } from './FilesView';
import { HistoryView } from './HistoryView';

type View = Prefs['sidebarView'];

const VIEWS: Array<{ id: View; label: MessageKey; Icon: ComponentType<{ size?: number }> }> = [
  { id: 'files', label: 'sidebar.files', Icon: FolderTree },
  { id: 'changes', label: 'sidebar.changes', Icon: FileDiff },
  { id: 'branches', label: 'sidebar.branches', Icon: GitBranch },
  { id: 'history', label: 'sidebar.history', Icon: History }
];

/** The panel beside the terminal, open by default: files, changes, branches and history of the tab's folder. */
export function Sidebar({ info, active }: { info: SessionInfo; active: boolean }) {
  const t = useT();
  const view = useUi((s) => s.prefs.sidebarView);
  const savedWidth = useUi((s) => s.prefs.filePanelWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? savedWidth;
  const changes = useChanges(info.id, active);
  const compact = width < 320;

  const save = (patch: Partial<Prefs>) => void api.prefs.set(patch).then((p) => useUi.getState().setPrefs(p), () => undefined);
  const saveWidth = (w: number) => {
    setDragWidth(null);
    if (w !== savedWidth) save({ filePanelWidth: w });
  };

  return (
    <aside data-testid="file-panel" style={{ width }} className="relative flex shrink-0 flex-col border-l border-border bg-panel/60">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('files.resize')}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/30"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragWidth(width);
        }}
        onPointerMove={(e) => {
          if (dragWidth === null) return;
          const right = e.currentTarget.parentElement!.getBoundingClientRect().right;
          setDragWidth(Math.round(Math.min(600, Math.max(200, right - e.clientX))));
        }}
        onPointerUp={() => dragWidth !== null && saveWidth(dragWidth)}
        onDoubleClick={() => saveWidth(280)}
      />
      <div role="toolbar" className="flex h-8 shrink-0 items-stretch border-b border-border px-1">
        {VIEWS.map(({ id, label, Icon }) => {
          const on = view === id;
          return (
            <Tip key={id} label={t(label)} side="bottom">
              <button
                type="button"
                aria-pressed={on}
                aria-label={t(label)}
                data-view={id}
                onClick={() => save({ sidebarView: id })}
                className={cn(
                  'relative flex items-center gap-1.5 px-2 text-[11px] font-medium outline-none',
                  on ? 'text-fg' : 'text-fg-muted hover:text-fg'
                )}
              >
                <Icon size={13} />
                {(!compact || on) && <span>{t(label)}</span>}
                {id === 'changes' && changes && changes.files.length > 0 && (
                  <span className="rounded bg-hover px-1 text-[10px] text-fg-muted">{changes.files.length}</span>
                )}
                {on && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />}
              </button>
            </Tip>
          );
        })}
        <span className="flex-1" />
        <Button variant="ghost" size="icon" aria-label={t('sidebar.close')} title={t('sidebar.close')} onClick={() => save({ sidebarOpen: false })}>
          <ChevronRight size={12} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {view === 'files' && <FilesView info={info} active={active} />}
        {view === 'changes' && <ChangesView info={info} active={active} />}
        {view === 'branches' && <BranchesView info={info} active={active} />}
        {view === 'history' && <HistoryView info={info} active={active} />}
      </div>
    </aside>
  );
}

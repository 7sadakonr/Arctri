import { Folder, GitBranch, TerminalSquare } from 'lucide-react';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { tNow, useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { MenuBar } from './MenuBar';

/**
 * The window's top strip: the menus, the folder of the tab in front in the middle (click copies it, double-click opens it
 * in Explorer) and its git branch at the right, next to the window buttons. Empty parts of it drag the window.
 */
export function TitleBar() {
  const t = useT();
  const id = useSessions((s) => s.activeId);
  const cwd = useSessions((s) => (s.activeId ? s.infos[s.activeId]?.cwd : undefined));
  const branch = useSessions((s) => (s.activeId ? s.infos[s.activeId]?.gitBranch : undefined));

  return (
    <div
      className="drag fixed z-30 flex items-center gap-1 pl-3"
      style={{
        left: 'env(titlebar-area-x, 0px)',
        top: 0,
        width: 'env(titlebar-area-width, 100%)',
        height: 'env(titlebar-area-height, 36px)'
      }}
    >
      <TerminalSquare size={14} className="mr-1 shrink-0 text-accent" />
      <MenuBar />
      <div className="flex min-w-0 flex-1 justify-center px-3 text-[11px] text-fg-muted">
        {id && cwd ? (
          <Tip label={t('toolbar.copyPath')} side="bottom">
            <button
              type="button"
              data-testid="location-path"
              className="no-drag flex min-w-0 items-center gap-1.5 hover:text-fg"
              onClick={() => void copyText(cwd.path).then(() => useUi.getState().toast(tNow('block.copied')))}
              onDoubleClick={() => void api.app.openPath(id)}
            >
              <Folder size={12} className="shrink-0" />
              <span className="truncate" dir="rtl">
                <bdi>{cwd.path}</bdi>
              </span>
            </button>
          </Tip>
        ) : (
          <span>Arctri</span>
        )}
      </div>
      {branch && (
        <span data-testid="location-branch" className="flex shrink-0 items-center gap-1 pr-2 text-[11px] text-fg" title={branch}>
          <GitBranch size={12} />
          <span className="max-w-[160px] truncate">{branch}</span>
        </span>
      )}
    </div>
  );
}

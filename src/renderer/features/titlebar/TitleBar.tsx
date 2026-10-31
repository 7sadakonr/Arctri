import { Folder, GitBranch } from 'lucide-react';
import { ArctriMark } from '@/components/ArctriMark';
import { Tip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { BRANCH_QUICK_SWITCH_EVENT } from '@/lib/branch-events';
import { cn } from '@/lib/cn';
import { isMac } from '@/lib/platform';
import { tNow, useT } from '@/lib/i18n';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { MenuBar } from './MenuBar';
import { NativeMenu } from './NativeMenu';
import { UpdateButton } from '../update/UpdateButton';

/**
 * The window's top strip: the menus, the folder of the tab in front in the middle (click copies it, double-click opens it
 * in Explorer or Finder) and its git branch at the right, next to the window buttons. Empty parts of it drag the window.
 */
export function TitleBar() {
  const t = useT();
  const id = useSessions((s) => s.activeId);
  const cwd = useSessions((s) => (s.activeId ? s.infos[s.activeId]?.cwd : undefined));
  const branch = useSessions((s) => (s.activeId ? s.infos[s.activeId]?.gitBranch : undefined));

  return (
    <>
    {/* the bar's colour across the whole window, also behind the window buttons (the bar itself stops before them) */}
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-20 bg-panel" style={{ height: 'env(titlebar-area-height, 35px)' }} />
    {/* the line under the title bar, across the whole window including under the window buttons */}
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 z-30 h-px bg-border" style={{ top: 'env(titlebar-area-height, 35px)' }} />
    <div
      // on a Mac the traffic lights sit at the left of the bar and there are no window buttons at the right
      className={cn('drag fixed z-30 flex items-center gap-1 bg-panel', isMac ? 'pl-[84px] pr-3' : 'pl-3')}
      style={{
        left: 'env(titlebar-area-x, 0px)',
        top: 0,
        width: 'env(titlebar-area-width, 100%)',
        height: 'env(titlebar-area-height, 35px)'
      }}
    >
      {!isMac && <ArctriMark size={14} className="mr-1 text-accent" />}
      {isMac ? <NativeMenu /> : <MenuBar />}
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
      <UpdateButton />
      {branch && (
        <button
          type="button"
          data-testid="location-branch"
          className="no-drag flex shrink-0 items-center gap-1 rounded px-1.5 py-1 pr-2 text-[11px] text-fg hover:bg-hover focus-visible:outline focus-visible:outline-accent"
          title={t('sidebar.switchTo', { name: branch })}
          aria-label={t('sidebar.quickSwitch')}
          onClick={() => {
            useUi.getState().setPrefs({ ...useUi.getState().prefs, sidebarView: 'branches', sidebarOpen: true });
            void api.prefs.set({ sidebarView: 'branches', sidebarOpen: true });
            requestAnimationFrame(() => window.dispatchEvent(new Event(BRANCH_QUICK_SWITCH_EVENT)));
          }}
        >
          <GitBranch size={12} />
          <span className="max-w-[160px] truncate">{branch}</span>
        </button>
      )}
    </div>
    </>
  );
}

import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { Sidebar } from './Sidebar';

/**
 * The sidebar, docked at the right of the window (not a tab of the grid). Every session with a folder keeps its own,
 * so what is expanded in one survives while another is in front; only the sidebar of the session in front is shown.
 */
export function SidebarDock() {
  const open = useUi((s) => s.prefs.sidebarOpen);
  const order = useSessions((s) => s.order);
  const infos = useSessions((s) => s.infos);
  const activeId = useSessions((s) => s.activeId);
  const width = useUi((s) => s.prefs.filePanelWidth);
  const withFolder = order.filter((id) => infos[id]?.cwd);
  if (!open || withFolder.length === 0) return null;
  const activeHasFolder = !!(activeId && infos[activeId]?.cwd);
  return (
    <>
      {/* a tab without a folder (yet) keeps the column's place, so the panes do not jump when the focus moves to a tab that has one */}
      {!activeHasFolder && <aside aria-hidden style={{ width }} className="shrink-0 border-l border-border bg-bg" />}
      {withFolder.map((id) => {
        const on = id === activeId;
        return (
          <div key={id} data-active={on} className={on ? 'flex shrink-0' : 'hidden'}>
            <Sidebar info={infos[id]!} active={on} />
          </div>
        );
      })}
    </>
  );
}

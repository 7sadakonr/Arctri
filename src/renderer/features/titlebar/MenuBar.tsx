import { useRef, useState } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { editCopy, editPaste, editSelectAll } from '@/lib/edit-actions';
import { focusActiveSession } from '@/lib/focus';
import { useT } from '@/lib/i18n';
import { stepZoom } from '@/lib/zoom';
import { useBlocks } from '@/stores/blocks';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import type { Prefs } from '@shared/prefs';
import { blockProfiles, closeSession, openProject, openShell, openSimilarTab, pickAndOpenProject, restartSession } from '../launcher/actions';
import { toggleSidebar } from '../sidebar/toggle';
import { projectName, toEnvPath } from '../welcome/recent';

type Entry =
  | { sep: true }
  | { label: string; detail?: string; shortcut?: string; disabled?: boolean; checked?: boolean; run?: () => void; sub?: Entry[] };

const SEP: Entry = { sep: true };
const RECENT_SHOWN = 10;

function useMenus(): Array<{ id: string; label: string; entries: Entry[] }> {
  const t = useT();
  const profiles = useUi((s) => s.profiles);
  const prefs = useUi((s) => s.prefs);
  const windowsDefault = useUi((s) => s.windowsDefaultProfile);
  const activeId = useSessions((s) => s.activeId);
  const info = useSessions((s) => (s.activeId ? s.infos[s.activeId] : undefined));
  const sidebar = useUi((s) => s.prefs.sidebarOpen);
  const hasTab = !!info;
  const hasFolder = !!info?.cwd;
  const blockMode = !!info && info.kind === 'shell' && info.presentation === 'blocks' && info.integration === 'active';
  const defaultId = (prefs.defaultProfile ?? windowsDefault ?? profiles[0]?.id ?? '').toLowerCase();

  const nextTab = (dir: 1 | -1) => {
    const s = useSessions.getState();
    if (s.order.length < 2 || !s.activeId) return;
    s.setActive(s.order[(s.order.indexOf(s.activeId) + dir + s.order.length) % s.order.length]!);
  };
  const save = async (patch: Partial<Prefs>) => {
    try {
      useUi.getState().setPrefs(await api.prefs.set(patch));
    } catch {
      /* rejected by the main process */
    }
  };
  const recent = prefs.recentProjects.slice(0, RECENT_SHOWN);

  return [
    {
      id: 'file', label: t('menu.file'),
      entries: [
        { label: t('menu.openFolder'), shortcut: 'Ctrl+K Ctrl+O', run: () => void pickAndOpenProject() },
        {
          label: t('menu.openRecent'),
          sub: recent.length
            ? [
                ...recent.map((r): Entry => ({
                  label: projectName(r.path),
                  detail: r.env === 'wsl' ? `${r.distro}: ${r.path}` : r.path,
                  run: () => void openProject(toEnvPath(r))
                })),
                SEP,
                { label: t('menu.clearRecent'), run: () => void save({ recentProjects: [] }) }
              ]
            : [{ label: t('menu.noRecent'), disabled: true }]
        },
        { label: t('menu.clone'), run: () => useUi.getState().setCloneOpen(true) },
        SEP,
        { label: t('menu.settings'), shortcut: 'Ctrl+,', run: () => useUi.getState().openSettings(true) },
        SEP,
        { label: t('menu.closeTab'), shortcut: 'Ctrl+Shift+W', disabled: !hasTab, run: () => activeId && void closeSession(activeId) },
        { label: t('menu.exit'), run: () => window.close() }
      ]
    },
    {
      id: 'edit', label: t('menu.edit'),
      entries: [] // built in MenuBar: copy/paste/select all act on what had focus before the menu opened
    },
    {
      id: 'view', label: t('menu.view'),
      entries: [
        {
          label: t('menu.filesPanel'), shortcut: 'Ctrl+Shift+E', checked: sidebar,
          run: () => toggleSidebar()
        },
        SEP,
        { label: t('menu.zoomIn'), shortcut: 'Ctrl+=', run: () => void stepZoom(1) },
        { label: t('menu.zoomOut'), shortcut: 'Ctrl+-', run: () => void stepZoom(-1) },
        { label: t('menu.zoomReset'), shortcut: 'Ctrl+0', run: () => void stepZoom(0) },
        SEP,
        {
          label: t('menu.theme'),
          sub: [
            { label: t('settings.theme.dark'), checked: prefs.theme === 'dark', run: () => void save({ theme: 'dark' }) },
            { label: t('settings.theme.light'), checked: prefs.theme === 'light', run: () => void save({ theme: 'light' }) }
          ]
        }
      ]
    },
    {
      id: 'terminal', label: t('menu.terminal'),
      entries: [
        // Same as Ctrl+Shift+T: a new tab with the current shell, starting at the shell's first folder
        { label: t('menu.newTerminal'), shortcut: 'Ctrl+Shift+T', run: () => void openSimilarTab() },
        {
          label: t('menu.newWithProfile'),
          sub: blockProfiles(profiles).map((p) => ({
            label: p.label,
            checked: p.id.toLowerCase() === defaultId,
            run: () => void openShell(p)
          }))
        },
        SEP,
        { label: t('menu.renameTab'), shortcut: 'F2', disabled: !hasTab, run: () => window.dispatchEvent(new Event('arctri:rename-tab')) },
        { label: t('menu.restart'), disabled: !hasTab, run: () => info && void restartSession(info) },
        { label: t('menu.clearTerminal'), shortcut: 'Ctrl+L', disabled: !blockMode, run: () => activeId && useBlocks.getState().drop(activeId) },
        { label: t('menu.showFolder'), disabled: !hasFolder, run: () => activeId && void api.app.openPath(activeId) },
        SEP,
        { label: t('menu.nextTab'), shortcut: 'Ctrl+Tab', disabled: !hasTab, run: () => nextTab(1) },
        { label: t('menu.prevTab'), shortcut: 'Ctrl+Shift+Tab', disabled: !hasTab, run: () => nextTab(-1) }
      ]
    },
    {
      id: 'help', label: t('menu.help'),
      entries: [
        { label: t('menu.shortcuts'), run: () => useUi.getState().setHelpDialog('shortcuts') },
        { label: t('menu.about'), run: () => useUi.getState().setHelpDialog('about') }
      ]
    }
  ];
}

function Entries({ entries }: { entries: Entry[] }) {
  return (
    <>
      {entries.map((e, i) => {
        if ('sep' in e) return <DropdownMenuSeparator key={`s${i}`} />;
        if (e.sub) {
          return (
            <DropdownMenuSub key={e.label}>
              <DropdownMenuSubTrigger>{e.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <Entries entries={e.sub} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        }
        return (
          <DropdownMenuItem key={e.label} disabled={!!e.disabled} onSelect={() => e.run?.()}>
            <span className="w-3 text-center">{e.checked ? '✓' : ''}</span>
            <span className="flex-1 truncate">{e.label}</span>
            {e.detail && <span className="max-w-[260px] truncate text-[10px] text-fg-muted" dir="rtl"><bdi>{e.detail}</bdi></span>}
            {e.shortcut && <DropdownMenuShortcut>{e.shortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

/** File / Edit / View / Terminal / Help. Opening one and moving over another switches menus, as in VS Code. */
export function MenuBar() {
  const t = useT();
  const menus = useMenus();
  const [open, setOpen] = useState<string | null>(null);
  const openNow = useRef<string | null>(null);
  openNow.current = open;
  // What had the focus before a menu took it: Edit > Copy/Paste must act on that, not on the menu.
  const before = useRef<Element | null>(null);
  const remember = () => {
    const el = document.activeElement;
    before.current = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el : null;
  };

  const edit: Entry[] = [
    { label: t('menu.copy'), shortcut: 'Ctrl+C', run: () => editCopy(before.current) },
    { label: t('menu.paste'), shortcut: 'Ctrl+V', run: () => void editPaste(before.current) },
    { label: t('menu.selectAll'), shortcut: 'Ctrl+A', run: () => editSelectAll(before.current) },
  ];

  return (
    <div className="no-drag flex items-center" role="menubar">
      {menus.map((m) => (
        <DropdownMenu
          key={m.id}
          modal={false}
          open={open === m.id}
          onOpenChange={(o) => setOpen((cur) => (o ? m.id : cur === m.id ? null : cur))}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onPointerDownCapture={remember}
              onPointerEnter={() => open && open !== m.id && setOpen(m.id)}
              className="rounded px-2 py-1 text-[12px] text-fg-muted outline-none hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
            >
              {m.label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={2}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              // Switching to another menu must not pull the focus out from under it.
              if (openNow.current === null) focusActiveSession();
            }}
          >
            <Entries entries={m.id === 'edit' ? edit : m.entries} />
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </div>
  );
}

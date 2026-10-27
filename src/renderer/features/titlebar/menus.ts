import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import type { Prefs } from '@shared/prefs';
import { blockProfiles, openProject, openShell } from '../launcher/actions';
import { commandById, commandCtx, commandShortcut, commandTitle, isEnabled, runCommand } from '@/commands/registry';
import { toAccelerator } from '@/commands/keys';
import { projectName, toEnvPath } from '../welcome/recent';

export type Entry =
  | { sep: true }
  | { label: string; detail?: string; shortcut?: string; accelerator?: string; disabled?: boolean; checked?: boolean; run?: () => void; sub?: Entry[] };

const SEP: Entry = { sep: true };

/** A menu item that is a command of the registry: title, shortcut and enabled-state come from there. */
function cmd(t: ReturnType<typeof useT>, id: string, extra: Partial<Extract<Entry, { label: string }>> = {}): Entry {
  const c = commandById(id);
  const shortcut = commandShortcut(c);
  const accelerator = toAccelerator(c.keys);
  return {
    label: t(commandTitle(c)),
    ...(shortcut ? { shortcut } : {}),
    ...(accelerator ? { accelerator } : {}),
    disabled: !isEnabled(c, commandCtx()),
    run: () => runCommand(c),
    ...extra
  };
}
const RECENT_SHOWN = 10;

export function useMenus(): Array<{ id: string; label: string; entries: Entry[] }> {
  const t = useT();
  const profiles = useUi((s) => s.profiles);
  const prefs = useUi((s) => s.prefs);
  const windowsDefault = useUi((s) => s.windowsDefaultProfile);
  // the enabled-state of each command is read from the stores while this renders, so the menu follows these
  useSessions((s) => (s.activeId ? s.infos[s.activeId] : undefined));
  useSessions((s) => s.order.length);
  const sidebar = useUi((s) => s.prefs.sidebarOpen);
  const defaultId = (prefs.defaultProfile ?? windowsDefault ?? profiles[0]?.id ?? '').toLowerCase();

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
        cmd(t, 'app.openFolder'),
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
        cmd(t, 'app.clone'),
        SEP,
        cmd(t, 'app.settings'),
        SEP,
        cmd(t, 'tab.close'),
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
        cmd(t, 'view.sidebar', { checked: sidebar }),
        cmd(t, 'changes.open'),
        cmd(t, 'branch.switch'),
        cmd(t, 'palette.open'),
        SEP,
        cmd(t, 'view.zoomIn'),
        cmd(t, 'view.zoomOut'),
        cmd(t, 'view.zoomReset'),
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
        cmd(t, 'tab.new'),
        {
          label: t('menu.newWithProfile'),
          sub: blockProfiles(profiles).map((p) => ({
            label: p.label,
            checked: p.id.toLowerCase() === defaultId,
            run: () => void openShell(p)
          }))
        },
        SEP,
        cmd(t, 'tab.rename'),
        cmd(t, 'tab.pin'),
        cmd(t, 'tab.find'),
        cmd(t, 'terminal.restart'),
        cmd(t, 'terminal.clear'),
        cmd(t, 'terminal.showFolder'),
        SEP,
        cmd(t, 'tab.next'),
        cmd(t, 'tab.prev')
      ]
    },
    {
      id: 'help', label: t('menu.help'),
      entries: [
        cmd(t, 'help.shortcuts'),
        cmd(t, 'help.checkUpdates'),
        cmd(t, 'help.about')
      ]
    }
  ];
}

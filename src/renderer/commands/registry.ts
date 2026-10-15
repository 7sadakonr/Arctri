import type { MessageKey } from '@shared/i18n';
import type { SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { BRANCH_QUICK_SWITCH_EVENT } from '@/lib/branch-events';
import { isMac, kbd } from '@/lib/platform';
import { stepZoom } from '@/lib/zoom';
import { useBlocks } from '@/stores/blocks';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { TOGGLE_RICH_EVENT } from '../features/agents/AgentBar';
import { closeSession, openSimilarTab, pickAndOpenProject, restartSession } from '../features/launcher/actions';
import { toggleSidebar } from '../features/sidebar/toggle';
import { matchKey, type PlatformKeys } from './keys';

export interface CommandCtx {
  activeId: string | undefined;
  info: SessionInfo | undefined;
  hasTab: boolean;
  hasFolder: boolean;
  /** The tab shows command blocks (clearing them makes sense). */
  blockMode: boolean;
  /** The tab runs an agent. */
  agentTab: boolean;
}

export function commandCtx(): CommandCtx {
  const s = useSessions.getState();
  const info = s.activeId ? s.infos[s.activeId] : undefined;
  return {
    activeId: s.activeId,
    info,
    hasTab: !!info,
    hasFolder: !!info?.cwd,
    blockMode: !!info && info.kind === 'shell' && info.presentation === 'blocks' && info.integration === 'active',
    agentTab: !!info && (info.kind === 'agent' || !!info.runningAgent)
  };
}

/**
 * One command, three ways in: the menu bar, the keyboard and the command palette. They all read this list,
 * so a title, a shortcut or an enabled-state is written once.
 */
export interface Command {
  id: string;
  title: MessageKey | (() => MessageKey);
  /** Extra words the palette also searches. */
  keywords?: string;
  /** The shortcut as it is shown (Windows spelling; `kbd` adapts it to the platform). */
  shortcut?: string;
  /** What the keyboard handler listens for. */
  keys?: PlatformKeys | PlatformKeys[];
  when?: (c: CommandCtx) => boolean;
  run: (c: CommandCtx) => void;
  /** Left out of the palette (the go-to-tab-N family, which the "Switch Tab" list replaces). */
  hidden?: boolean;
}

const NEEDS_TAB = (c: CommandCtx) => c.hasTab;

function step(dir: 1 | -1): void {
  const s = useSessions.getState();
  if (s.order.length < 2 || !s.activeId) return;
  s.setActive(s.order[(s.order.indexOf(s.activeId) + dir + s.order.length) % s.order.length]!);
}

function showSidebar(view: 'changes' | 'branches'): void {
  const prefs = { sidebarView: view, sidebarOpen: true } as const;
  useUi.getState().setPrefs({ ...useUi.getState().prefs, ...prefs });
  void api.prefs.set(prefs);
}

export const OPEN_PALETTE_EVENT = 'arctri:open-palette';

const gotoTab = (n: number): Command => ({
  id: `tab.goto${n}`,
  title: 'menu.gotoTab',
  hidden: true,
  keys: { key: String(n), mod: true },
  when: () => !!useSessions.getState().order[n - 1],
  run: () => {
    const id = useSessions.getState().order[n - 1];
    if (id) useSessions.getState().setActive(id);
  }
});

export const COMMANDS: Command[] = [
  { id: 'palette.open', title: 'cmd.palette', shortcut: 'Ctrl+Shift+P', keys: { key: 'p', mod: true, shift: true }, run: () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)), hidden: true },
  {
    id: 'tab.new', title: 'menu.newTerminal', keywords: 'create shell tab', shortcut: 'Ctrl+Shift+T',
    keys: { mac: { key: 't', mod: true }, other: { key: 't', mod: true, shift: true } }, run: () => void openSimilarTab()
  },
  {
    id: 'tab.close', title: 'menu.closeTab', shortcut: 'Ctrl+Shift+W', when: NEEDS_TAB,
    keys: { mac: { key: 'w', mod: true }, other: { key: 'w', mod: true, shift: true } },
    run: (c) => c.activeId && void closeSession(c.activeId)
  },
  { id: 'tab.next', title: 'menu.nextTab', shortcut: 'Ctrl+Tab', keys: { key: 'tab', ctrl: true }, when: NEEDS_TAB, run: () => step(1) },
  { id: 'tab.prev', title: 'menu.prevTab', shortcut: 'Ctrl+Shift+Tab', keys: { key: 'tab', ctrl: true, shift: true }, when: NEEDS_TAB, run: () => step(-1) },
  {
    id: 'tab.rename', title: 'menu.renameTab', shortcut: 'F2', keys: { key: 'f2' }, when: NEEDS_TAB,
    run: () => window.dispatchEvent(new Event('arctri:rename-tab'))
  },
  {
    id: 'tab.pin', title: 'cmd.pinTab', keywords: 'unpin keep', when: NEEDS_TAB,
    run: (c) => c.activeId && useSessions.getState().togglePin(c.activeId)
  },
  { id: 'tab.find', title: 'cmd.findSession', keywords: 'switch tab search session agent', run: () => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: 'tabs' })) },
  { id: 'app.openFolder', title: 'menu.openFolder', shortcut: 'Ctrl+K Ctrl+O', keywords: 'project', run: () => void pickAndOpenProject() },
  { id: 'app.clone', title: 'menu.clone', keywords: 'git repository', run: () => useUi.getState().setCloneOpen(true) },
  { id: 'app.settings', title: 'menu.settings', keywords: 'preferences options', shortcut: 'Ctrl+,', keys: { key: ',', mod: true }, run: () => useUi.getState().openSettings(true) },
  { id: 'view.sidebar', title: 'menu.filesPanel', shortcut: 'Ctrl+Shift+E', keys: { key: 'e', mod: true, shift: true }, run: () => toggleSidebar() },
  { id: 'changes.open', title: 'cmd.openChanges', keywords: 'git diff modified', when: (c) => c.hasFolder, run: () => showSidebar('changes') },
  {
    id: 'branch.switch', title: 'cmd.switchBranch', keywords: 'git checkout', when: (c) => c.hasFolder,
    run: () => {
      showSidebar('branches');
      requestAnimationFrame(() => window.dispatchEvent(new Event(BRANCH_QUICK_SWITCH_EVENT)));
    }
  },
  {
    id: 'view.zoomIn', title: 'menu.zoomIn', shortcut: 'Ctrl+=',
    keys: [{ key: '=', mod: true, anyShift: true }, { key: '+', mod: true, anyShift: true }], run: () => void stepZoom(1)
  },
  { id: 'view.zoomOut', title: 'menu.zoomOut', shortcut: 'Ctrl+-', keys: { key: '-', mod: true, anyShift: true }, run: () => void stepZoom(-1) },
  { id: 'view.zoomReset', title: 'menu.zoomReset', shortcut: 'Ctrl+0', keys: { key: '0', mod: true, anyShift: true }, run: () => void stepZoom(0) },
  {
    id: 'terminal.clear', title: 'menu.clearTerminal', shortcut: 'Ctrl+L', when: (c) => c.blockMode,
    run: (c) => c.activeId && useBlocks.getState().drop(c.activeId)
  },
  { id: 'terminal.restart', title: 'menu.restart', when: NEEDS_TAB, run: (c) => c.info && void restartSession(c.info) },
  {
    id: 'terminal.showFolder', title: () => (isMac ? 'menu.showFolderMac' : 'menu.showFolder'), when: (c) => c.hasFolder,
    run: (c) => c.activeId && void api.app.openPath(c.activeId)
  },
  {
    id: 'agent.richInput', title: 'cmd.richInput', shortcut: 'Ctrl+G', keys: { key: 'g', ctrl: true }, when: (c) => c.agentTab,
    run: () => window.dispatchEvent(new Event(TOGGLE_RICH_EVENT))
  },
  { id: 'help.shortcuts', title: 'menu.shortcuts', run: () => useUi.getState().setHelpDialog('shortcuts') },
  { id: 'help.about', title: 'menu.about', run: () => useUi.getState().setHelpDialog('about') },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gotoTab)
];

export const commandById = (id: string): Command => COMMANDS.find((c) => c.id === id)!;
export const commandTitle = (c: Command): MessageKey => (typeof c.title === 'function' ? c.title() : c.title);
export const commandShortcut = (c: Command): string | undefined => (c.shortcut ? kbd(c.shortcut) : undefined);
export const isEnabled = (c: Command, ctx: CommandCtx): boolean => !c.when || c.when(ctx);

/** The command a key press stands for, if it is enabled right now. */
export function commandForKey(e: KeyboardEvent, ctx = commandCtx()): Command | undefined {
  return COMMANDS.find((c) => c.keys && matchKey(e, c.keys, isMac) && isEnabled(c, ctx));
}

export function runCommand(c: Command): void {
  const ctx = commandCtx();
  if (!isEnabled(c, ctx)) return;
  c.run(ctx);
}

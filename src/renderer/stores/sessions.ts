import { create } from 'zustand';
import type { BlockSnapshot } from '@shared/types/block';
import type { SessionInfo, ShellPhase } from '@shared/types/session';

export interface ViewerTab {
  /** Identity of the tab: the file's path, or `<rev>:<path>` for a file as a commit changed it. */
  rel: string;
  mode: 'file' | 'diff';
  /** The file's path when `rel` is not it. */
  path?: string;
  /** Shows the file as this commit changed it (read-only, against the commit's parent). */
  rev?: string;
  /** Opened by a single click in the Changes list: the next such click replaces this tab instead of adding another. */
  preview?: boolean;
}
export interface ViewerState {
  tabs: ViewerTab[];
  active: string;
  /** The editor takes the whole width; the terminal is hidden until it is restored. */
  maximized?: boolean;
}

interface SessionsState {
  order: string[];
  infos: Record<string, SessionInfo>;
  activeId: string | undefined;
  /** Phase as seen by the renderer's own parser; in step with what xterm has drawn. */
  uiPhase: Record<string, ShellPhase>;
  /** The prompt the shell is showing right now (what the command editor puts in front of the input). */
  prompt: Record<string, BlockSnapshot | undefined>;
  setPrompt(id: string, prompt: BlockSnapshot | undefined): void;
  /** The files (relative to the tab's folder) shown beside the terminal, each as it is or as a diff against HEAD. */
  viewer: Record<string, ViewerState | undefined>;
  openViewer(id: string, rel: string, mode: 'file' | 'diff', extra?: { path?: string; rev?: string; preview?: boolean }): void;
  /** Keeps a preview tab: it is no longer replaced by the next preview. */
  pinViewer(id: string, rel: string): void;
  /** Closes one file; without `rel` (or after the last one) the whole panel. */
  closeViewer(id: string, rel?: string): void;
  setViewerMaximized(id: string, on: boolean): void;
  /** Pinned tabs sit at the left, are drawn as an icon and are not pushed into the overflow menu. */
  pinned: Record<string, boolean>;
  togglePin(id: string): void;
  upsert(info: SessionInfo, activate?: boolean): void;
  remove(id: string): void;
  setActive(id: string): void;
  move(from: number, to: number): void;
  setUiPhase(id: string, phase: ShellPhase): void;
}

export const useSessions = create<SessionsState>()((set) => ({
  order: [],
  infos: {},
  activeId: undefined,
  uiPhase: {},
  prompt: {},
  setPrompt: (id, prompt) => set((s) => ({ prompt: { ...s.prompt, [id]: prompt } })),
  pinned: {},
  togglePin: (id) =>
    set((s) => {
      if (!s.infos[id]) return s;
      const on = !s.pinned[id];
      const pinned = { ...s.pinned, [id]: on };
      if (!on) delete pinned[id];
      // pinned tabs stay together at the left
      const rest = s.order.filter((x) => x !== id);
      const lastPinned = rest.reduce((n, x, i) => (pinned[x] ? i + 1 : n), 0);
      rest.splice(lastPinned, 0, id);
      return { pinned, order: rest };
    }),
  viewer: {},
  openViewer: (id, rel, mode, extra) =>
    set((s) => {
      const tabs = s.viewer[id]?.tabs ?? [];
      const tab: ViewerTab = { rel, mode, ...(extra?.path ? { path: extra.path } : {}), ...(extra?.rev ? { rev: extra.rev } : {}) };
      let next: ViewerTab[];
      if (tabs.some((x) => x.rel === rel)) next = tabs.map((x) => (x.rel === rel ? { ...x, ...tab } : x));
      else if (extra?.preview) {
        const at = tabs.findIndex((x) => x.preview);
        next = at < 0 ? [...tabs, { ...tab, preview: true }] : tabs.map((x, i) => (i === at ? { ...tab, preview: true } : x));
      } else next = [...tabs, tab];
      return { viewer: { ...s.viewer, [id]: { ...s.viewer[id], tabs: next, active: rel } } };
    }),
  pinViewer: (id, rel) =>
    set((s) => {
      const v = s.viewer[id];
      if (!v?.tabs.some((x) => x.rel === rel && x.preview)) return s;
      return { viewer: { ...s.viewer, [id]: { ...v, tabs: v.tabs.map((x) => (x.rel === rel ? { ...x, preview: false } : x)) } } };
    }),
  closeViewer: (id, rel) =>
    set((s) => {
      const v = s.viewer[id];
      if (!v || rel === undefined) return { viewer: { ...s.viewer, [id]: undefined } };
      const i = v.tabs.findIndex((x) => x.rel === rel);
      if (i < 0) return s;
      const tabs = v.tabs.filter((x) => x.rel !== rel);
      if (!tabs.length) return { viewer: { ...s.viewer, [id]: undefined } };
      const active = v.active === rel ? tabs[Math.min(i, tabs.length - 1)]!.rel : v.active;
      return { viewer: { ...s.viewer, [id]: { ...v, tabs, active } } };
    }),
  setViewerMaximized: (id, on) =>
    set((s) => {
      const v = s.viewer[id];
      return v && !!v.maximized !== on ? { viewer: { ...s.viewer, [id]: { ...v, maximized: on } } } : s;
    }),
  upsert: (info, activate) =>
    set((s) => {
      const known = !!s.infos[info.id];
      return {
        infos: { ...s.infos, [info.id]: info },
        order: known ? s.order : [...s.order, info.id],
        activeId: activate || (!known && !s.activeId) ? info.id : s.activeId
      };
    }),
  remove: (id) =>
    set((s) => {
      const idx = s.order.indexOf(id);
      const order = s.order.filter((x) => x !== id);
      const { [id]: _gone, ...infos } = s.infos;
      const { [id]: _p, ...uiPhase } = s.uiPhase;
      const { [id]: _pr, ...prompt } = s.prompt;
      const { [id]: _v, ...viewer } = s.viewer;
      const { [id]: _pin, ...pinned } = s.pinned;
      let activeId = s.activeId;
      if (activeId === id) activeId = order[Math.min(idx, order.length - 1)];
      return { order, infos, uiPhase, prompt, viewer, pinned, activeId };
    }),
  setActive: (id) =>
    set({ activeId: id }),
  move: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.order.length || to >= s.order.length) return s;
      const order = [...s.order];
      const [id] = order.splice(from, 1);
      order.splice(to, 0, id!);
      return { order };
    }),
  setUiPhase: (id, phase) => set((s) => (s.uiPhase[id] === phase ? s : { uiPhase: { ...s.uiPhase, [id]: phase } }))
}));

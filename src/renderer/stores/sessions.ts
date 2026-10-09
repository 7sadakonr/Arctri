import { create } from 'zustand';
import type { SessionInfo, ShellPhase } from '@shared/types/session';

interface SessionsState {
  order: string[];
  infos: Record<string, SessionInfo>;
  activeId: string | undefined;
  /** Phase as seen by the renderer's own parser; in step with what xterm has drawn. */
  uiPhase: Record<string, ShellPhase>;
  nativePrompt: Record<string, boolean>;
  /** An agent in this tab wants attention (finished a turn, asks for approval) while it was not on screen. */
  attention: Record<string, boolean>;
  /** The read-only file panel is open for this tab. */
  explorer: Record<string, boolean>;
  setExplorer(id: string, on: boolean): void;
  /** The file (relative to the tab's folder) shown beside the terminal, as it is or as a diff against HEAD. */
  viewer: Record<string, { rel: string; mode: 'file' | 'diff' } | undefined>;
  openViewer(id: string, rel: string, mode: 'file' | 'diff'): void;
  closeViewer(id: string): void;
  setAttention(id: string, on: boolean): void;
  upsert(info: SessionInfo, activate?: boolean): void;
  remove(id: string): void;
  setActive(id: string): void;
  move(from: number, to: number): void;
  setUiPhase(id: string, phase: ShellPhase): void;
  setNativePrompt(id: string, on: boolean): void;
}

export const useSessions = create<SessionsState>()((set) => ({
  order: [],
  infos: {},
  activeId: undefined,
  uiPhase: {},
  nativePrompt: {},
  attention: {},
  explorer: {},
  viewer: {},
  openViewer: (id, rel, mode) => set((s) => ({ viewer: { ...s.viewer, [id]: { rel, mode } } })),
  closeViewer: (id) => set((s) => ({ viewer: { ...s.viewer, [id]: undefined } })),
  setExplorer: (id, on) => set((s) => ({ explorer: { ...s.explorer, [id]: on } })),
  setAttention: (id, on) =>
    set((s) => (!!s.attention[id] === on ? s : { attention: { ...s.attention, [id]: on } })),
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
      const { [id]: _n, ...nativePrompt } = s.nativePrompt;
      const { [id]: _a, ...attention } = s.attention;
      const { [id]: _e, ...explorer } = s.explorer;
      const { [id]: _v, ...viewer } = s.viewer;
      let activeId = s.activeId;
      if (activeId === id) activeId = order[Math.min(idx, order.length - 1)];
      return { order, infos, uiPhase, nativePrompt, attention, explorer, viewer, activeId };
    }),
  setActive: (id) =>
    set((s) => ({ activeId: id, attention: s.attention[id] ? { ...s.attention, [id]: false } : s.attention })),
  move: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.order.length || to >= s.order.length) return s;
      const order = [...s.order];
      const [id] = order.splice(from, 1);
      order.splice(to, 0, id!);
      return { order };
    }),
  setUiPhase: (id, phase) => set((s) => (s.uiPhase[id] === phase ? s : { uiPhase: { ...s.uiPhase, [id]: phase } })),
  setNativePrompt: (id, on) => set((s) => ({ nativePrompt: { ...s.nativePrompt, [id]: on } }))
}));

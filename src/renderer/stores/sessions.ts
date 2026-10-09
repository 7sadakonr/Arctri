import { create } from 'zustand';
import type { SessionInfo, ShellPhase } from '@shared/types/session';

interface SessionsState {
  order: string[];
  infos: Record<string, SessionInfo>;
  activeId: string | undefined;
  /** Phase as seen by the renderer's own parser; in step with what xterm has drawn. */
  uiPhase: Record<string, ShellPhase>;
  nativePrompt: Record<string, boolean>;
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
      let activeId = s.activeId;
      if (activeId === id) activeId = order[Math.min(idx, order.length - 1)];
      return { order, infos, uiPhase, nativePrompt, activeId };
    }),
  setActive: (id) => set({ activeId: id }),
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

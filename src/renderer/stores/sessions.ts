import { create } from 'zustand';
import type { BlockSnapshot } from '@shared/types/block';
import type { SessionInfo, ShellPhase } from '@shared/types/session';

interface SessionsState {
  order: string[];
  infos: Record<string, SessionInfo>;
  activeId: string | undefined;
  /** Phase as seen by the renderer's own parser; in step with what xterm has drawn. */
  uiPhase: Record<string, ShellPhase>;
  /** The prompt the shell is showing right now (what the command editor puts in front of the input). */
  prompt: Record<string, BlockSnapshot | undefined>;
  setPrompt(id: string, prompt: BlockSnapshot | undefined): void;
  /** Pinned tabs sit at the left, are drawn as an icon and are not pushed into the overflow menu. */
  pinned: Record<string, boolean>;
  togglePin(id: string): void;
  upsert(info: SessionInfo, activate?: boolean): void;
  remove(id: string): void;
  setActive(id: string): void;
  move(from: number, to: number): void;
  setUiPhase(id: string, phase: ShellPhase): void;
  /** Tabs being created: the main process has not answered yet, so there is no session to draw. */
  pendingOpen: number;
  addPending(delta: number): void;
  /** The first load (preferences, restored tabs) has finished. */
  booted: boolean;
  setBooted(): void;
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
  pendingOpen: 0,
  addPending: (delta) => set((s) => ({ pendingOpen: Math.max(0, s.pendingOpen + delta) })),
  booted: false,
  setBooted: () => set({ booted: true }),
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
      const { [id]: _pin, ...pinned } = s.pinned;
      let activeId = s.activeId;
      if (activeId === id) activeId = order[Math.min(idx, order.length - 1)];
      return { order, infos, uiPhase, prompt, pinned, activeId };
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

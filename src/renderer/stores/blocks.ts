import { create } from 'zustand';
import type { CommandBlock } from '@shared/types/block';

const MAX_BLOCKS = 500;

interface BlocksState {
  blocks: Record<string, CommandBlock[]>;
  selected: Record<string, string | undefined>;
  add(b: CommandBlock): void;
  replace(b: CommandBlock): void;
  toggleCollapsed(sessionId: string, blockId: string): void;
  select(sessionId: string, blockId: string | undefined): void;
  drop(sessionId: string): void;
}

export const useBlocks = create<BlocksState>()((set) => ({
  blocks: {},
  selected: {},
  add: (b) =>
    set((s) => {
      const list = [...(s.blocks[b.sessionId] ?? []), b];
      return { blocks: { ...s.blocks, [b.sessionId]: list.length > MAX_BLOCKS ? list.slice(-MAX_BLOCKS) : list } };
    }),
  replace: (b) =>
    set((s) => {
      const list = s.blocks[b.sessionId] ?? [];
      const i = list.findIndex((x) => x.id === b.id);
      const next = i === -1 ? [...list, b] : list.map((x, j) => (j === i ? { ...b, collapsed: x.collapsed } : x));
      return { blocks: { ...s.blocks, [b.sessionId]: next } };
    }),
  toggleCollapsed: (sessionId, blockId) =>
    set((s) => ({
      blocks: {
        ...s.blocks,
        [sessionId]: (s.blocks[sessionId] ?? []).map((b) => (b.id === blockId ? { ...b, collapsed: !b.collapsed } : b))
      }
    })),
  select: (sessionId, blockId) => set((s) => ({ selected: { ...s.selected, [sessionId]: blockId } })),
  drop: (sessionId) =>
    set((s) => {
      const { [sessionId]: _b, ...blocks } = s.blocks;
      const { [sessionId]: _s, ...selected } = s.selected;
      return { blocks, selected };
    })
}));

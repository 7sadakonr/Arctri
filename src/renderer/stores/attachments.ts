import { create } from 'zustand';
import type { TrackedAttachment } from '../features/agents/attachment-tracker';

interface AttachmentsState {
  bySession: Record<string, TrackedAttachment[] | undefined>;
  add(id: string, items: TrackedAttachment[]): void;
  set(id: string, items: TrackedAttachment[]): void;
  remove(id: string, attachmentId: string): void;
  clear(id: string): void;
}

export const useAttachments = create<AttachmentsState>()((set) => ({
  bySession: {},
  add: (id, items) => set((s) => ({ bySession: { ...s.bySession, [id]: [...(s.bySession[id] ?? []), ...items] } })),
  set: (id, items) => set((s) => ({ bySession: { ...s.bySession, [id]: items } })),
  remove: (id, aid) =>
    set((s) => ({ bySession: { ...s.bySession, [id]: (s.bySession[id] ?? []).filter((a) => a.id !== aid) } })),
  clear: (id) =>
    set((s) => {
      if (!s.bySession[id]?.length) return s;
      const { [id]: _gone, ...rest } = s.bySession;
      return { bySession: rest };
    })
}));

import { create } from 'zustand';

interface EditorsState {
  /** File tabs (by tab key) whose text has edits that are not saved yet. */
  dirty: Record<string, true>;
  setDirty(key: string, on: boolean): void;
}

export const useEditors = create<EditorsState>()((set) => ({
  dirty: {},
  setDirty: (key, on) =>
    set((s) => {
      if (!!s.dirty[key] === on) return s;
      if (on) return { dirty: { ...s.dirty, [key]: true } };
      const { [key]: _gone, ...dirty } = s.dirty;
      return { dirty };
    })
}));

/** Unsaved text of file tabs that are not on screen right now (a tab moved to another group, or one behind the front tab). */
export const parkedText = new Map<string, { text: string; mode: 'file' | 'diff' }>();

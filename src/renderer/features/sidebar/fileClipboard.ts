import { create } from 'zustand';

/** What Cut or Copy last took in the file panel (paths relative to the tab's folder). Not the system clipboard. */
export interface FileClip {
  sessionId: string;
  paths: string[];
  mode: 'cut' | 'copy';
}

export const useFileClip = create<{ clip: FileClip | undefined; set(clip: FileClip | undefined): void }>()((set) => ({
  clip: undefined,
  set: (clip) => set({ clip })
}));

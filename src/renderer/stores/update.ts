import { create } from 'zustand';
import type { UpdateStatus } from '@shared/types/update';

interface UpdateState {
  status: UpdateStatus | undefined;
  dialogOpen: boolean;
  /** Set when an install was refused because work is running: how many sessions would be ended. */
  busy: number | null;
  setStatus(s: UpdateStatus): void;
  openDialog(open: boolean): void;
  setBusy(n: number | null): void;
}

export const useUpdate = create<UpdateState>()((set) => ({
  status: undefined,
  dialogOpen: false,
  busy: null,
  setStatus: (status) => set({ status }),
  openDialog: (dialogOpen) => set({ dialogOpen, busy: null }),
  setBusy: (busy) => set({ busy })
}));

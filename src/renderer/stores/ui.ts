import { create } from 'zustand';
import type { Prefs } from '@shared/prefs';
import { defaultPrefs } from '@shared/prefs';
import type { ShellProfile } from '@shared/types/env';
import type { WslStatus } from '@shared/types/wsl';
import type { AgentEntry } from '@shared/types/agent';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface UiState {
  prefs: Prefs;
  profiles: ShellProfile[];
  wsl: WslStatus;
  /** The profile Windows Terminal starts by default (undefined when it is not installed). */
  windowsDefaultProfile: string | undefined;
  agents: AgentEntry[];
  agentsLoading: boolean;
  windowsBuild: number;
  settingsOpen: boolean;
  cloneOpen: boolean;
  helpDialog: 'shortcuts' | 'about' | null;
  toasts: Toast[];
  setPrefs(p: Prefs): void;
  setProfiles(profiles: ShellProfile[], wsl: WslStatus, defaultProfileId?: string): void;
  setAgents(a: AgentEntry[]): void;
  setAgentsLoading(b: boolean): void;
  setWindowsBuild(n: number): void;
  openSettings(open: boolean): void;
  setCloneOpen(open: boolean): void;
  setHelpDialog(d: UiState['helpDialog']): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useUi = create<UiState>()((set, get) => ({
  prefs: defaultPrefs(),
  profiles: [],
  wsl: { available: false, reason: 'loading' },
  windowsDefaultProfile: undefined,
  agents: [],
  agentsLoading: false,
  windowsBuild: 19045,
  settingsOpen: false,
  cloneOpen: false,
  helpDialog: null,
  toasts: [],
  setPrefs: (prefs) => set({ prefs }),
  setProfiles: (profiles, wsl, defaultProfileId) => set({ profiles, wsl, windowsDefaultProfile: defaultProfileId }),
  setAgents: (agents) => set({ agents }),
  setAgentsLoading: (agentsLoading) => set({ agentsLoading }),
  setWindowsBuild: (windowsBuild) => set({ windowsBuild }),
  openSettings: (settingsOpen) => set({ settingsOpen }),
  setCloneOpen: (cloneOpen) => set({ cloneOpen }),
  setHelpDialog: (helpDialog) => set({ helpDialog }),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-4) }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 2500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}));

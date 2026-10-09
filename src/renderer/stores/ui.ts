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
  agents: AgentEntry[];
  agentsLoading: boolean;
  windowsBuild: number;
  settingsOpen: boolean;
  toasts: Toast[];
  setPrefs(p: Prefs): void;
  setProfiles(profiles: ShellProfile[], wsl: WslStatus): void;
  setAgents(a: AgentEntry[]): void;
  setAgentsLoading(b: boolean): void;
  setWindowsBuild(n: number): void;
  openSettings(open: boolean): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useUi = create<UiState>()((set, get) => ({
  prefs: defaultPrefs(),
  profiles: [],
  wsl: { available: false, reason: 'loading' },
  agents: [],
  agentsLoading: false,
  windowsBuild: 19045,
  settingsOpen: false,
  toasts: [],
  setPrefs: (prefs) => set({ prefs }),
  setProfiles: (profiles, wsl) => set({ profiles, wsl }),
  setAgents: (agents) => set({ agents }),
  setAgentsLoading: (agentsLoading) => set({ agentsLoading }),
  setWindowsBuild: (windowsBuild) => set({ windowsBuild }),
  openSettings: (settingsOpen) => set({ settingsOpen }),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-4) }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 2500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}));

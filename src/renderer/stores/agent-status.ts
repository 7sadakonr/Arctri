import { create } from 'zustand';
import type { AgentStatus } from '@shared/types/agent-status';

interface AgentStatusState {
  byId: Record<string, AgentStatus | undefined>;
  set(id: string, status: AgentStatus | null): void;
  reset(list: AgentStatus[]): void;
}

export const useAgentStatus = create<AgentStatusState>()((set) => ({
  byId: {},
  set: (id, status) =>
    set((s) => {
      if (!status) {
        if (!(id in s.byId)) return s;
        const { [id]: _gone, ...rest } = s.byId;
        return { byId: rest };
      }
      return { byId: { ...s.byId, [id]: status } };
    }),
  reset: (list) => set({ byId: Object.fromEntries(list.map((x) => [x.sessionId, x])) })
}));

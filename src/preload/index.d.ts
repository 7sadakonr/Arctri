import type { AgentDockApi } from './index';

declare global {
  interface Window {
    agentdock: AgentDockApi;
  }
}
export {};

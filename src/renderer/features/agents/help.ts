import type { AgentId } from '@shared/types/agent';

/** Official installation documentation; AgentDock never installs agents itself. */
export const AGENT_HELP: Record<AgentId, string> = {
  'claude-code': 'https://docs.claude.com/en/docs/claude-code/setup',
  codex: 'https://github.com/openai/codex#installing-and-running-codex-cli'
};

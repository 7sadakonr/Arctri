import type { AgentId } from '../types/session';

const HINT = 'It only works while the CLI is waiting for input.';

export interface AgentMeta {
  id: AgentId;
  name: string;
  /** Slash commands offered as shortcuts; they are sent as typed text. */
  nativeCommands: Array<{ label: string; text: string; hint: string }>;
  /** Slash command that exists only in this agent's chat (never offered to the other one). */
  remoteControl?: { text: string; hint: string };
}

export const AGENT_META: Record<AgentId, AgentMeta> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    nativeCommands: [
      { label: '/model', text: '/model', hint: HINT },
      { label: '/compact', text: '/compact', hint: HINT },
      { label: '/clear', text: '/clear', hint: HINT },
      { label: '/help', text: '/help', hint: HINT }
    ],
    remoteControl: { text: '/remote-control', hint: 'Starts a Remote Control session. ' + HINT }
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    nativeCommands: [
      { label: '/model', text: '/model', hint: HINT },
      { label: '/approvals', text: '/approvals', hint: HINT },
      { label: '/status', text: '/status', hint: HINT },
      { label: '/new', text: '/new', hint: HINT }
    ]
    // Codex's remote-control is a command-line subcommand that manages a daemon, not a chat command: no button.
  }
};

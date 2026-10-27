import type { AgentId } from '../types/session';

const HINT = 'It only works while the CLI is waiting for input.';

export interface AgentMeta {
  id: AgentId;
  name: string;
  /** Slash commands offered as shortcuts; they are sent as typed text. */
  nativeCommands: Array<{ label: string; text: string; hint: string }>;
  /** Slash command that exists only in this agent's chat (never offered to the other one). */
  remoteControl?: { text: string; hint: string };
  /** How the message box looks on screen, to tell which attachments are still in the message. */
  input: { prompt: RegExp; placeholder: RegExp };
  /** The key with which the agent itself pastes the image on the clipboard, as the bytes the terminal sends. */
  pasteImageKey(env: 'windows' | 'wsl' | 'local'): string;
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
    remoteControl: { text: '/remote-control', hint: 'Starts a Remote Control session. ' + HINT },
    input: { prompt: /^\s*[│|]?\s*[>❯]/, placeholder: /\[Image #\d+\]/g },
    // Alt+V where Claude Code runs on Windows itself, Ctrl+V elsewhere (WSL counts as Linux)
    pasteImageKey: (env) => (env === 'windows' ? '\x1bv' : '\x16')
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    nativeCommands: [
      { label: '/model', text: '/model', hint: HINT },
      { label: '/approvals', text: '/approvals', hint: HINT },
      { label: '/status', text: '/status', hint: HINT },
      { label: '/new', text: '/new', hint: HINT }
    ],
    // Codex's remote-control is a command-line subcommand that manages a daemon, not a chat command: no button.
    input: { prompt: /^\s*[│|]?\s*›/, placeholder: /\[Image #\d+\]/g },
    pasteImageKey: () => '\x16'
  }
};

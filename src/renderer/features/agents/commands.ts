import { api } from '@/lib/api';
import { peekHost } from '../terminal/xterm-host';

/** A slash command the user clicked: typed into the agent as text, then Enter. The agent decides what it does. */
export function sendCommand(sessionId: string, text: string): void {
  api.sessions.write(sessionId, text);
  setTimeout(() => api.sessions.write(sessionId, '\r'), 60);
  peekHost(sessionId)?.focus();
}

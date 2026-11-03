import { AGENT_META } from '@shared/agents/meta';
import type { Attachment } from '@shared/types/attachment';
import { api } from '@/lib/api';
import { useAttachments } from '@/stores/attachments';
import { useSessions } from '@/stores/sessions';
import { peekHost } from '../terminal/xterm-host';
import { placeholdersIn } from './attachment-tracker';

export const INSERT_EVENT = 'arctri:insert-text';

/** "@path" reference for a path that is relative to the tab's folder. Quoted when it contains spaces. */
export const refOf = (rel: string): string => (/[\s"'`$()&;|<>]/.test(rel) ? `@"${rel.replace(/"/g, '\\"')}"` : `@${rel}`);

/**
 * Puts text into the conversation without sending it: an agent gets it as a paste (bracketed when it asked for that),
 * a plain shell tab gets it in the command editor. Enter is never added.
 */
export function insertText(sessionId: string, text: string): void {
  const info = useSessions.getState().infos[sessionId];
  if (!info) return;
  if (info.kind === 'agent' || info.runningAgent) {
    const host = peekHost(sessionId);
    host?.term.paste(text + ' ');
    host?.focus();
  } else {
    const detail = { sessionId, text, handled: false };
    window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail }));
    if (!detail.handled) {
      // no command editor is showing (classic tab, or a command is running): the text goes to the terminal instead
      const host = peekHost(sessionId);
      host?.term.paste(text + ' ');
      host?.focus();
    }
  }
}

/** The user's own explicit "send": the text is pasted and then Enter is pressed. */
export function sendToAgent(sessionId: string, text: string): void {
  const host = peekHost(sessionId);
  if (!host) return;
  host.term.paste(text);
  setTimeout(() => api.sessions.write(sessionId, '\r'), 80);
  host.focus();
}

export async function attachFiles(sessionId: string): Promise<Attachment[]> {
  return api.files.pick(sessionId);
}

/**
 * Puts attachments into the message and remembers them for the preview in the agent bar. The preview follows the
 * message: see `trackAttachments` in the terminal host.
 */
export function insertAttachments(sessionId: string, atts: Attachment[]): void {
  if (!atts.length) return;
  const info = useSessions.getState().infos[sessionId];
  const agentId = info?.kind === 'agent' ? info.agentId : info?.runningAgent?.agentId;
  const input = agentId ? AGENT_META[agentId]?.input : undefined;
  const host = peekHost(sessionId);
  const tokensBefore = input && host ? placeholdersIn(host.screenLines(), input) : [];
  const now = Date.now();
  useAttachments.getState().add(
    sessionId,
    atts.map((a, i) => ({ ...a, id: `${now}-${i}`, addedAt: now, tokensBefore, seen: false }))
  );
  insertText(sessionId, atts.map((a) => a.ref).join(' '));
}

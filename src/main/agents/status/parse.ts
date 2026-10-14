import { z } from 'zod';
import type { AgentId } from '@shared/types/agent';
import type { AgentState, AgentStatusEvent } from '@shared/types/agent-status';

/** What the hook script writes: the session secret plus the CLI's own payload, untouched. */
export const envelopeSchema = z.object({
  nonce: z.string().min(1).max(100),
  agent: z.enum(['claude', 'codex']),
  payload: z.unknown()
});

const claudePayload = z.object({
  hook_event_name: z.string().max(80),
  session_id: z.string().max(200).optional(),
  notification_type: z.string().max(80).optional(),
  tool_name: z.string().max(200).optional()
});

const codexPayload = z.object({
  type: z.string().max(80),
  'thread-id': z.string().max(200).optional(),
  thread_id: z.string().max(200).optional()
});

type Base = { sessionId: string; now: number };

/** Event names verified against Claude Code 2.1.x hooks (see ADR-010). Anything not listed is not guessed at: it is dropped. */
export function parseClaudeHook(payload: unknown, b: Base): AgentStatusEvent | null {
  const p = claudePayload.safeParse(payload);
  if (!p.success) return null;
  const { hook_event_name: event, notification_type: nt, session_id, tool_name } = p.data;
  let state: AgentState | undefined;
  switch (event) {
    case 'SessionStart': state = 'ready'; break;
    case 'UserPromptSubmit':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'ElicitationResult': state = 'working'; break;
    // AskUserQuestion is Claude asking the user something: waiting for an answer, shown as soon as the tool starts
    // (the permission notification for it only comes several seconds later)
    case 'PreToolUse': state = tool_name === 'AskUserQuestion' ? 'waiting' : 'working'; break;
    case 'PermissionRequest': state = tool_name === 'AskUserQuestion' ? 'waiting' : 'needs-approval'; break;
    case 'Elicitation': state = 'waiting'; break;
    case 'Notification':
      // idle_prompt: Claude has finished and simply sits at its prompt, which is the normal ready state; only a question or a dialog is waiting
      state = nt === 'permission_prompt' ? 'needs-approval' : nt === 'elicitation_dialog' ? 'waiting' : nt === 'idle_prompt' ? 'ready' : undefined;
      break;
    case 'Stop': state = 'finished'; break;
    // SessionEnd is not used: it also comes with /clear and resume while the process lives on; the process end is known from the PTY
  }
  if (!state) return null;
  return {
    sessionId: b.sessionId, agentId: 'claude-code' as AgentId, state, timestamp: b.now, source: 'claude-hook', confidence: 'high',
    ...(session_id ? { agentSessionId: session_id } : {}),
    detail: { event, ...(nt ? { notificationType: nt } : {}), ...(tool_name && (event.startsWith('PreToolUse') || event.startsWith('PostToolUse') || event === 'PermissionRequest') ? { tool: tool_name } : {}) }
  };
}

/** Codex's `notify` program is told about `agent-turn-complete` only; approvals cannot be confirmed from it. */
export function parseCodexNotify(payload: unknown, b: Base): AgentStatusEvent | null {
  const p = codexPayload.safeParse(payload);
  if (!p.success || p.data.type !== 'agent-turn-complete') return null;
  const thread = p.data['thread-id'] ?? p.data.thread_id;
  return {
    sessionId: b.sessionId, agentId: 'codex', state: 'finished', timestamp: b.now, source: 'codex-notify', confidence: 'high',
    ...(thread ? { agentSessionId: thread } : {}), detail: { event: p.data.type }
  };
}

/** When the hook script wrote the event (it adds `ts`: nanoseconds, or seconds where `date` has no `%N`). Only for measuring delay. */
export function sentAtMs(text: string): number | undefined {
  const m = /"ts":(\d{9,19})/.exec(text.slice(0, 200));
  if (!m) return undefined;
  const n = Number(m[1]);
  return n > 1e17 ? n / 1e6 : n > 1e11 ? n : n * 1000;
}

/** The file is from this tab's own hook (right secret, right shape), whether or not it describes a status we use. */
export function isTrustedEnvelope(text: string, expectedNonce: string): boolean {
  if (text.length > 64 * 1024) return false;
  try {
    const e = envelopeSchema.safeParse(JSON.parse(text));
    return e.success && e.data.nonce === expectedNonce;
  } catch {
    return false;
  }
}

export function parseEnvelope(text: string, expectedNonce: string, b: Base): AgentStatusEvent | null {
  if (text.length > 64 * 1024) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const e = envelopeSchema.safeParse(json);
  if (!e.success || e.data.nonce !== expectedNonce) return null;
  return e.data.agent === 'claude' ? parseClaudeHook(e.data.payload, b) : parseCodexNotify(e.data.payload, b);
}

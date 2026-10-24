import { z } from 'zod';
import { activityOf } from '@shared/agents/activity';
import type { AgentId } from '@shared/types/agent';
import type { AgentState, AgentStatusEvent } from '@shared/types/agent-status';

/** What the hook script writes: the session secret plus the CLI's own payload, untouched. */
export const envelopeSchema = z.object({
  nonce: z.string().min(1).max(100),
  agent: z.enum(['claude', 'codex']),
  /** The model in use as the hook script found it; empty when it did not. */
  model: z.string().max(200).optional(),
  payload: z.unknown()
});

const claudePayload = z.object({
  hook_event_name: z.string().max(80),
  session_id: z.string().max(200).optional(),
  notification_type: z.string().max(80).optional(),
  tool_name: z.string().max(200).optional(),
  tool_input: z.unknown().optional(),
  /** SessionStart names the model: an id, or an object with `id` / `display_name`. */
  model: z.unknown().optional(),
  transcript_path: z.string().max(1000).optional()
});

const codexPayload = z.object({
  type: z.string().max(80),
  'thread-id': z.string().max(200).optional(),
  thread_id: z.string().max(200).optional()
});

type Base = { sessionId: string; now: number };

/** Event names verified against Claude Code 2.1.x hooks (see ADR-010). Anything not listed is not guessed at: it is dropped. */
const MODEL = /^[A-Za-z0-9._:/@+-]+( [A-Za-z0-9._:/@+-]+)*$/; // an id (claude-opus-5-5) or a name as /model shows it (Opus 5.5)
/** A model name is shown as it is reported, so it must be plain: anything else is ignored. */
export const cleanModel = (m: string | undefined): string | undefined => (m && m.length <= 80 && MODEL.test(m) ? m : undefined);

/** The model as the SessionStart payload names it. */
const payloadModel = (m: unknown): string | undefined => {
  if (typeof m === 'string') return cleanModel(m);
  if (m && typeof m === 'object') {
    const o = m as Record<string, unknown>;
    for (const k of ['display_name', 'id']) if (typeof o[k] === 'string' && cleanModel(o[k] as string)) return o[k] as string;
  }
  return undefined;
};

const SAFE_TRANSCRIPT = /^\/[A-Za-z0-9._/@+ -]+\.jsonl$/;
/** A transcript is followed only when its path is plain and absolute: it comes from the agent's own payload. */
export const cleanTranscriptPath = (p: string | undefined): string | undefined => (p && !p.includes('..') && SAFE_TRANSCRIPT.test(p) ? p : undefined);

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
  const ev = e.data.agent === 'claude' ? parseClaudeHook(e.data.payload, b) : parseCodexNotify(e.data.payload, b);
  if (!ev) return ev;
  const claude = e.data.agent === 'claude' ? claudePayload.safeParse(e.data.payload).data : undefined;
  const model = cleanModel(e.data.model) ?? payloadModel(claude?.model);
  const event = ev.detail?.event;
  const activity = !claude ? undefined
    : event === 'PreToolUse' && claude.tool_name ? activityOf(claude.tool_name, claude.tool_input)
    : undefined;
  const transcriptPath = cleanTranscriptPath(claude?.transcript_path);
  return model || activity || transcriptPath
    ? { ...ev, ...(model ? { model } : {}), ...(activity ? { activity } : {}), ...(transcriptPath ? { transcriptPath } : {}) }
    : ev;
}

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterUserInput, reduceStatus, type UserInputKind } from '@shared/agents/status-rules';
import type { AgentId } from '@shared/types/agent';
import type { AgentState, AgentStatus, AgentStatusEvent, StatusReason } from '@shared/types/agent-status';
import type { SessionId } from '@shared/types/session';
import { TranscriptModelWatch } from './status/model-watch';
import { cleanModel } from './status/parse';
import { EventSpool, type EventMeta } from './status/spool';

export interface StatusServiceDeps {
  /** `<userData>/agent-events` */
  root: string;
  /** Whether the window is focused (a tab in front of a window in the background is not being looked at). */
  windowFocused: () => boolean;
  /** Only a tab that runs an agent may have its status changed by an event file (a one-shot `claude -p` in a shell must not). */
  acceptsEvents?: (id: SessionId) => boolean;
  /** Diagnostics: state changes and dropped events (names only, never prompt or output text). */
  log?: (message: string, extra?: unknown) => void;
  /** How long an agent may stay `starting` without any event (tests shorten it). */
  noEventsMs?: number;
  /** What the agent is doing now, for the name of the tab; null once it is not working on anything. */
  onActivity?: (id: SessionId, activity: string | null) => void;
  /** Where to read a transcript the agent named (a path as the agent sees it); null when it cannot be reached from here. */
  transcriptFile?: (id: SessionId, agentPath: string) => string | null;
  onChanged: (status: AgentStatus | null, id: SessionId) => void;
  now?: () => number;
}

/**
 * The single owner of agent status in the main process. Facts come from adapters (hooks, notify), from the PTY lifecycle
 * and from plain terminal signals; they are merged by the pure rules in `@shared/agents/status-rules`.
 * With no trustworthy signal a tab's state is `unknown`: output text is never interpreted.
 */
/** States in which the agent is busy with something, so what it does is worth showing. */
const ACTIVE = new Set<AgentState>(['working', 'needs-approval', 'waiting']);

export const NO_EVENTS_MS = 20_000;

export class AgentStatusService {
  private status = new Map<SessionId, AgentStatus>();
  private spools = new Map<SessionId, EventSpool>();
  private readonly now: () => number;

  constructor(private readonly deps: StatusServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  private activeId: SessionId | null = null;

  private watching(id: SessionId): boolean {
    return id === this.activeId && this.deps.windowFocused();
  }

  /** The renderer's front tab (or the window gaining focus): whatever it has to say is now seen. */
  setActive(id: SessionId | null): void {
    this.activeId = id;
    if (id && this.deps.windowFocused()) this.markRead(id);
  }

  spoolDir(id: SessionId): string {
    return join(this.deps.root, id);
  }

  settingsPath(id: SessionId): string {
    return join(this.deps.root, `${id}.settings.json`);
  }

  /** Starts listening for the hook events of a tab; returns the directory the agent must write to. */
  watch(id: SessionId, nonce: string): string {
    this.spools.get(id)?.stop(); // never two watchers on one tab (a restart, a re-attach)
    const spool = new EventSpool(this.spoolDir(id), id, nonce, (e, meta) => this.apply(e, meta), this.now, this.deps.log);
    this.spools.set(id, spool);
    spool.start();
    return spool.dir;
  }

  private startTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();
  private lastSentAt = new Map<SessionId, number>();

  /**
   * A tab that starts an agent. With hooks in place it is `starting` until the agent's first event; if none comes within
   * `NO_EVENTS_MS` it becomes `unknown` (the time only ever lowers it to unknown, it never confirms anything).
   * Without hooks (nothing will ever be reported) it is `unknown` at once, with the reason in `noHooks`.
   */
  begin(id: SessionId, agentId: AgentId, noHooks?: Extract<StatusReason, `no-hooks-${string}`>): void {
    const hooksExpected = !noHooks;
    this.spools.get(id)?.setFast(true);
    this.lastSentAt.delete(id);
    this.apply({
      sessionId: id, agentId, state: hooksExpected ? 'starting' : 'unknown', timestamp: this.now(),
      source: 'pty', confidence: 'high', detail: { event: hooksExpected ? 'start' : 'start-no-hooks' },
      ...(noHooks ? { reason: noHooks } : {})
    });
    this.cancelStartTimer(id);
    if (!hooksExpected) return;
    const t = setTimeout(() => {
      this.startTimers.delete(id);
      if (this.status.get(id)?.state !== 'starting') return;
      this.apply({ sessionId: id, agentId, state: 'unknown', timestamp: this.now(), source: 'pty', confidence: 'high', detail: { event: 'no-events' }, reason: 'no-events' });
    }, this.deps.noEventsMs ?? NO_EVENTS_MS);
    t.unref?.();
    this.startTimers.set(id, t);
  }

  private cancelStartTimer(id: SessionId): void {
    const t = this.startTimers.get(id);
    if (t) clearTimeout(t);
    this.startTimers.delete(id);
  }

  apply(raw: AgentStatusEvent, meta: EventMeta = {}): void {
    const { activity, transcriptPath, ...ev } = raw; // the activity and the transcript go elsewhere, not into the status
    if (ev.source !== 'pty' && this.deps.acceptsEvents && !this.deps.acceptsEvents(ev.sessionId)) {
      this.deps.log?.('agent event ignored: no agent runs in this tab', { id: ev.sessionId, event: ev.detail?.event });
      return;
    }
    // Claude sends a "needs permission" notification for an AskUserQuestion several seconds after the question is on screen;
    // the question is already shown as waiting, and it is not an approval.
    const cur = this.status.get(ev.sessionId);
    if (ev.detail?.event === 'Notification' && ev.state === 'needs-approval' && cur?.state === 'waiting' && cur.detail?.tool === 'AskUserQuestion') {
      this.deps.log?.('agent event ignored: the notification belongs to a question', { id: ev.sessionId });
      return;
    }
    if (meta.sentAt !== undefined) {
      // events may be read late or out of order: one written before the newest one already seen is stale
      const last = this.lastSentAt.get(ev.sessionId);
      if (last !== undefined && meta.sentAt < last) {
        this.deps.log?.('agent event ignored: older than one already seen', { id: ev.sessionId, event: ev.detail?.event });
        return;
      }
      this.lastSentAt.set(ev.sessionId, meta.sentAt);
    }
    if (ev.source !== 'pty') this.cancelStartTimer(ev.sessionId);
    if (transcriptPath) this.followTranscript(ev.sessionId, transcriptPath);
    if (ev.state === 'exited') this.stopTranscript(ev.sessionId);
    const next = reduceStatus(this.status.get(ev.sessionId), ev, this.watching(ev.sessionId));
    if (next === this.status.get(ev.sessionId)) return;
    // the tool's label lasts as long as the tool call; after it (and when the agent stops) the tab goes back to the session's name
    const toolDone = ev.detail?.event === 'PostToolUse' || ev.detail?.event === 'PostToolUseFailure';
    if (ACTIVE.has(next.state) && !toolDone) {
      if (activity) this.deps.onActivity?.(ev.sessionId, activity);
    } else this.deps.onActivity?.(ev.sessionId, null);
    this.status.set(ev.sessionId, next);
    this.deps.log?.('agent status', { id: ev.sessionId, state: next.state, source: next.source, event: ev.detail?.event, ...meta });
    this.deps.onChanged(next, ev.sessionId);
  }

  private transcripts = new Map<SessionId, TranscriptModelWatch>();

  /** `/model` writes to the transcript at once; following it keeps the model of the agent bar current between hook events. */
  private followTranscript(id: SessionId, agentPath: string): void {
    const file = this.deps.transcriptFile?.(id, agentPath);
    if (!file || this.transcripts.get(id)?.file === file) return;
    this.stopTranscript(id);
    const w = new TranscriptModelWatch(file, (model) => this.setModel(id, model));
    this.transcripts.set(id, w);
    w.start();
  }

  private stopTranscript(id: SessionId): void {
    this.transcripts.get(id)?.stop();
    this.transcripts.delete(id);
  }

  /** A model named on its own: the state, its age and its unread mark stay as they are. */
  private setModel(id: SessionId, model: string): void {
    const cur = this.status.get(id);
    const clean = cleanModel(model);
    if (!cur || !clean || cur.model === clean) return;
    const next = { ...cur, model: clean };
    this.status.set(id, next);
    this.deps.onChanged(next, id);
  }

  /** BEL / OSC 9 / OSC 777 seen in a tab that runs an agent: a hint that something wants attention, nothing more. */
  terminalSignal(id: SessionId, agentId: AgentId): void {
    this.apply({ sessionId: id, agentId, state: 'unknown', timestamp: this.now(), source: 'terminal-signal', confidence: 'low', detail: { event: 'signal' }, reason: 'signal' });
  }

  /** The process ended; a non-zero `exitCode` (or none, for a failed start) is an abnormal end and counts as news. */
  exited(id: SessionId, agentId: AgentId, exitCode?: number | null): void {
    this.apply({
      sessionId: id, agentId, state: 'exited', timestamp: this.now(), source: 'pty', confidence: 'high',
      detail: { event: 'exit', ...(exitCode ? { exitCode } : {}) }
    });
  }

  userInput(id: SessionId, kind: UserInputKind): void {
    const cur = this.status.get(id);
    if (!cur) return;
    const next = afterUserInput(cur, this.now(), kind);
    if (next !== cur) {
      this.status.set(id, next);
      this.deps.onChanged(next, id);
    }
  }

  markRead(id: SessionId | 'all'): void {
    for (const [k, v] of this.status) {
      if ((id === 'all' || id === k) && v.unread) {
        const next = { ...v, unread: false };
        this.status.set(k, next);
        this.deps.onChanged(next, k);
      }
    }
  }

  private hookTabs = new Set<SessionId>();
  private noHooksTabs = new Map<SessionId, Extract<StatusReason, `no-hooks-${string}`>>();

  /** This tab's shell was started with the variables that let an agent typed into it report its status. */
  expectHooks(id: SessionId): void {
    this.hookTabs.add(id);
    this.noHooksTabs.delete(id);
  }

  /** This tab's shell cannot report (Windows-native, another shell, unsafe paths): an agent typed into it stays `unknown` with this reason. */
  noHooks(id: SessionId, reason: Extract<StatusReason, `no-hooks-${string}`>): void {
    this.hookTabs.delete(id);
    this.noHooksTabs.set(id, reason);
  }

  hooksExpected(id: SessionId): boolean {
    return this.hookTabs.has(id);
  }

  noHooksReason(id: SessionId): Extract<StatusReason, `no-hooks-${string}`> | undefined {
    return this.hookTabs.has(id) ? undefined : (this.noHooksTabs.get(id) ?? 'no-hooks-shell');
  }

  /** The agent in a shell tab ended: its status goes, the tab keeps listening for the next one. */
  clear(id: SessionId): void {
    this.cancelClear(id);
    this.cancelStartTimer(id);
    this.lastSentAt.delete(id);
    // a file the ended agent wrote but we have not read yet must not land on the next agent of this tab
    this.spools.get(id)?.discardPending();
    this.spools.get(id)?.setFast(false);
    this.stopTranscript(id);
    if (this.status.delete(id)) {
      this.deps.log?.('agent status cleared', { id });
      this.deps.onChanged(null, id);
    }
  }

  private clearTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();

  /** Like `clear`, after a short wait that is cancelled if the agent shows up again (the tab's own bookkeeping may flicker). */
  clearSoon(id: SessionId, ms = 1500): void {
    if (!this.status.has(id) || this.clearTimers.has(id)) return;
    const t = setTimeout(() => {
      this.clearTimers.delete(id);
      this.clear(id);
    }, ms);
    t.unref?.();
    this.clearTimers.set(id, t);
  }

  cancelClear(id: SessionId): void {
    const t = this.clearTimers.get(id);
    if (t) clearTimeout(t);
    this.clearTimers.delete(id);
  }

  has(id: SessionId): boolean {
    return this.status.has(id);
  }

  list(): AgentStatus[] {
    return [...this.status.values()];
  }

  forget(id: SessionId): void {
    this.cancelClear(id);
    this.cancelStartTimer(id);
    this.lastSentAt.delete(id);
    this.hookTabs.delete(id);
    this.noHooksTabs.delete(id);
    if (!this.spools.has(id) && !this.status.has(id)) return;
    this.spools.get(id)?.stop();
    this.spools.delete(id);
    try {
      rmSync(this.settingsPath(id), { force: true });
    } catch {
      // removed with the rest of the folder at the next start
    }
    if (this.status.delete(id)) this.deps.onChanged(null, id);
  }

  dropped(): number {
    return [...this.spools.values()].reduce((n, s) => n + s.dropped, 0);
  }
}

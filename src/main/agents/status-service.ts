import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterUserInput, reduceStatus } from '@shared/agents/status-rules';
import type { AgentId } from '@shared/types/agent';
import type { AgentStatus, AgentStatusEvent } from '@shared/types/agent-status';
import type { SessionId } from '@shared/types/session';
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
  onChanged: (status: AgentStatus | null, id: SessionId) => void;
  now?: () => number;
}

/**
 * The single owner of agent status in the main process. Facts come from adapters (hooks, notify), from the PTY lifecycle
 * and from plain terminal signals; they are merged by the pure rules in `@shared/agents/status-rules`.
 * With no trustworthy signal a tab's state is `unknown`: output text is never interpreted.
 */
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
   * Without hooks (nothing will ever be reported) it is `unknown` at once.
   */
  begin(id: SessionId, agentId: AgentId, hooksExpected = true): void {
    this.spools.get(id)?.setFast(true);
    this.lastSentAt.delete(id);
    this.apply({
      sessionId: id, agentId, state: hooksExpected ? 'starting' : 'unknown', timestamp: this.now(),
      source: 'pty', confidence: 'high', detail: { event: hooksExpected ? 'start' : 'start-no-hooks' }
    });
    this.cancelStartTimer(id);
    if (!hooksExpected) return;
    const t = setTimeout(() => {
      this.startTimers.delete(id);
      if (this.status.get(id)?.state !== 'starting') return;
      this.apply({ sessionId: id, agentId, state: 'unknown', timestamp: this.now(), source: 'pty', confidence: 'high', detail: { event: 'no-events' } });
    }, this.deps.noEventsMs ?? NO_EVENTS_MS);
    t.unref?.();
    this.startTimers.set(id, t);
  }

  private cancelStartTimer(id: SessionId): void {
    const t = this.startTimers.get(id);
    if (t) clearTimeout(t);
    this.startTimers.delete(id);
  }

  apply(ev: AgentStatusEvent, meta: EventMeta = {}): void {
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
    const next = reduceStatus(this.status.get(ev.sessionId), ev, this.watching(ev.sessionId));
    if (next === this.status.get(ev.sessionId)) return;
    this.status.set(ev.sessionId, next);
    this.deps.log?.('agent status', { id: ev.sessionId, state: next.state, source: next.source, event: ev.detail?.event, ...meta });
    this.deps.onChanged(next, ev.sessionId);
  }

  /** BEL / OSC 9 / OSC 777 seen in a tab that runs an agent: a hint that something wants attention, nothing more. */
  terminalSignal(id: SessionId, agentId: AgentId): void {
    this.apply({ sessionId: id, agentId, state: 'unknown', timestamp: this.now(), source: 'terminal-signal', confidence: 'low', detail: { event: 'signal' } });
  }

  exited(id: SessionId, agentId: AgentId): void {
    this.apply({ sessionId: id, agentId, state: 'exited', timestamp: this.now(), source: 'pty', confidence: 'high', detail: { event: 'exit' } });
  }

  userInput(id: SessionId, kind: 'any' | 'interrupt' = 'any'): void {
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

  /** This tab's shell was started with the variables that let an agent typed into it report its status. */
  expectHooks(id: SessionId): void {
    this.hookTabs.add(id);
  }

  hooksExpected(id: SessionId): boolean {
    return this.hookTabs.has(id);
  }

  /** The agent in a shell tab ended: its status goes, the tab keeps listening for the next one. */
  clear(id: SessionId): void {
    this.cancelClear(id);
    this.cancelStartTimer(id);
    this.lastSentAt.delete(id);
    this.spools.get(id)?.setFast(false);
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

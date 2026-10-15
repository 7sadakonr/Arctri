import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { AgentStatusEvent } from '@shared/types/agent-status';
import { isTrustedEnvelope, parseEnvelope, sentAtMs } from './parse';

/**
 * One directory per tab. The hook script drops a JSON file there (written as `.tmp`, then renamed);
 * this reads each finished file once, checks the session secret and the shape, and deletes it.
 */
/** What is known about an event besides its content: when the hook wrote it, and how long it waited to be read. */
export interface EventMeta {
  sentAt?: number;
  latencyMs?: number;
}

export const IDLE_POLL_MS = 1000;
export const FAST_POLL_MS = 250;
/** One pass reads at most this many files, so a burst never holds the main thread for long; the rest follows on the next turn of the event loop. */
export const MAX_PER_PASS = 25;

export class EventSpool {
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setInterval>;
  dropped = 0;

  constructor(
    readonly dir: string,
    private readonly sessionId: string,
    private readonly nonce: string,
    private readonly onEvent: (e: AgentStatusEvent, meta: EventMeta) => void,
    private readonly now: () => number = Date.now,
    private readonly log?: (message: string, extra?: unknown) => void
  ) {}

  start(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try {
      this.watcher = watch(this.dir, () => this.drain());
      this.watcher.on('error', () => undefined);
    } catch {
      // a directory that cannot be watched (some network drives) is still polled
    }
    this.schedule(IDLE_POLL_MS);
  }

  /** Looks more often while an agent runs in the tab: the file watcher is not reliable on every file system. */
  setFast(fast: boolean): void {
    this.schedule(fast ? FAST_POLL_MS : IDLE_POLL_MS);
  }

  private pollMs = 0;

  private schedule(ms: number): void {
    if (ms === this.pollMs && this.timer) return;
    this.pollMs = ms;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.drain(), ms);
    this.timer.unref?.();
  }

  /** Reads and throws away whatever is waiting: events of an agent that has ended are not news for the next one. */
  discardPending(): void {
    this.discarding = true;
    try {
      for (let i = 0; i < 20 && (i === 0 || this.pending() > 0); i++) this.drain();
    } finally {
      this.discarding = false;
    }
  }

  private discarding = false;

  private pending(): number {
    try {
      return readdirSync(this.dir).filter((n) => n.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  private more?: ReturnType<typeof setImmediate>;
  private stopped = false;

  drain(): void {
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((n) => n.endsWith('.json')).sort();
    } catch {
      return;
    }
    if (names.length > MAX_PER_PASS && !this.more && !this.stopped) {
      this.more = setImmediate(() => {
        this.more = undefined;
        this.drain();
      });
    }
    for (const name of names.slice(0, MAX_PER_PASS)) {
      const file = join(this.dir, name);
      let text: string | undefined;
      try {
        const size = statSync(file).size;
        if (size <= 64 * 1024) text = readFileSync(file, 'utf8');
        else this.log?.('agent event dropped', { reason: 'oversize', size });
      } catch {
        continue; // renamed or removed under us
      }
      try {
        rmSync(file, { force: true });
      } catch {
        // keep going; it is dropped on the next pass
      }
      if (this.discarding) continue;
      const ev = text === undefined ? null : parseEnvelope(text, this.nonce, { sessionId: this.sessionId, now: this.now() });
      if (ev) {
        const sent = text === undefined ? undefined : sentAtMs(text);
        this.onEvent(ev, sent === undefined ? {} : { sentAt: sent, latencyMs: Math.max(0, Math.round(this.now() - sent)) });
      } else if (text !== undefined && isTrustedEnvelope(text, this.nonce)) {
        // a genuine event of ours that is not a status (SessionEnd, a notification type we do not use): not a fault
        this.log?.('agent event is not a status', { size: text.length });
      } else {
        this.dropped++;
        if (text !== undefined) this.log?.('agent event dropped', { reason: 'rejected', size: text.length });
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    if (this.timer) clearInterval(this.timer);
    if (this.more) clearImmediate(this.more);
    this.more = undefined;
    for (let i = 0; i < 20 && this.pending() > 0; i++) this.drain(); // the last events of a closing tab are still read, in order
    this.drain();
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch {
      // the folder is under userData and is cleaned up on the next start
    }
  }
}

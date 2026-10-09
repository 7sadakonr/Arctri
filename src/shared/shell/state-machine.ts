import type { ShellEvent } from '../osc/protocol';
import type { ShellPhase } from '../types/session';

export interface PendingCommand {
  commandId?: number;
  text: string;
  startedAt?: number;
}

export type Transition =
  | { kind: 'none' }
  | { kind: 'blockStarted'; command: PendingCommand & { startedAt: number } }
  | {
      kind: 'blockFinished';
      command: PendingCommand & { startedAt: number };
      exitCode?: number;
      endedAt: number;
      /** 'unknown' when the shell never reported an exit status. */
      status: 'success' | 'failed' | 'unknown';
    }
  | { kind: 'anomaly'; reason: string };

/**
 * Prompt/command lifecycle driven only by integration events. No timeouts,
 * no prompt-text matching, no Enter-key interception.
 *
 *   unknown --hello--> prompt --A--> prompt --B--> editing
 *   editing --cmd--> editing(pending) --C--> executing --D--> prompt
 */
export class ShellStateMachine {
  phase: ShellPhase = 'unknown';
  cwd?: string;
  blocksCapable = false;
  helloSeen = false;
  private pending: PendingCommand | undefined;
  private running: (PendingCommand & { startedAt: number }) | undefined;

  get current(): PendingCommand | undefined {
    return this.running ?? this.pending;
  }

  apply(ev: ShellEvent, now: number): Transition {
    switch (ev.t) {
      case 'hello':
        this.helloSeen = true;
        this.blocksCapable = ev.blocks;
        if (this.phase === 'unknown') this.phase = 'prompt';
        return { kind: 'none' };
      case 'cwd':
        this.cwd = ev.path;
        return { kind: 'none' };
      case 'promptStart': {
        if (this.phase === 'executing' && this.running) {
          const command = this.running;
          this.running = undefined;
          this.phase = 'prompt';
          return { kind: 'blockFinished', command, endedAt: now, status: 'unknown' };
        }
        this.pending = undefined;
        this.phase = 'prompt';
        return { kind: 'none' };
      }
      case 'inputStart':
        if (this.phase === 'executing') return { kind: 'anomaly', reason: 'B while executing' };
        this.phase = 'editing';
        return { kind: 'none' };
      case 'commandLine':
        // A shell that runs several commands from one input buffer (bash with a multi-line paste) reports
        // each of them before the next prompt. They belong to one block.
        if (this.phase === 'executing' && this.running) {
          this.pending = { commandId: ev.commandId, text: ev.text };
          return { kind: 'none' };
        }
        if (this.phase === 'executing') return { kind: 'anomaly', reason: 'cmd while executing' };
        this.pending = { commandId: ev.commandId, text: ev.text };
        return { kind: 'none' };
      case 'executed': {
        if (this.phase === 'executing' && this.running && this.pending) {
          const more = this.pending.text;
          this.pending = undefined;
          if (more) this.running = { ...this.running, text: this.running.text ? `${this.running.text}\n${more}` : more };
          return { kind: 'none' };
        }
        if (this.phase === 'executing') return { kind: 'anomaly', reason: 'C while executing' };
        if (this.phase === 'unknown') return { kind: 'anomaly', reason: 'C before hello' };
        const command = { ...(this.pending ?? { text: '' }), startedAt: now };
        this.pending = undefined;
        this.running = command;
        this.phase = 'executing';
        return { kind: 'blockStarted', command };
      }
      case 'finished': {
        if (this.phase !== 'executing' || !this.running) {
          return { kind: 'anomaly', reason: 'D without C' };
        }
        const command = this.running;
        this.running = undefined;
        this.phase = 'prompt';
        const status =
          ev.exitCode === undefined ? 'unknown' : ev.exitCode === 0 ? 'success' : 'failed';
        const base = { kind: 'blockFinished', command, endedAt: now, status } as const;
        return ev.exitCode === undefined ? base : { ...base, exitCode: ev.exitCode };
      }
    }
  }

  /** PTY exited. A running command is reported as interrupted by the caller. */
  closed(now: number): Transition {
    if (this.running) {
      const command = this.running;
      this.running = undefined;
      this.phase = 'unknown';
      return { kind: 'blockFinished', command, endedAt: now, status: 'unknown' };
    }
    this.phase = 'unknown';
    return { kind: 'none' };
  }
}

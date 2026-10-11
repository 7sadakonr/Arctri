import { OSC_ARCTRI, OSC_MARK, parseOsc } from '@shared/osc/protocol';
import { ShellStateMachine, type Transition } from '@shared/shell/state-machine';
import type { BlockSnapshot, CommandBlock } from '@shared/types/block';
import type { EnvPath, EnvironmentRef, ShellKind } from '@shared/types/env';
import { snapshotRange, type BufferLike } from './snapshot';

interface MarkerLike {
  readonly line: number;
  readonly isDisposed: boolean;
  dispose(): void;
}
interface Disposable {
  dispose(): void;
}
interface TrackerTerm {
  parser: { registerOscHandler(id: number, cb: (data: string) => boolean): Disposable };
  buffer: { active: BufferLike & { type: string }; normal: BufferLike; onBufferChange(cb: (b: { type: string }) => void): Disposable };
  registerMarker(offset?: number): MarkerLike | undefined;
}

const MAX_PROMPT_LINES = 4;

/**
 * Some shells (zsh) pad the prompt line with spaces out to the width of the terminal. Taken as they are, those spaces
 * would make the prompt as wide as the window and leave no room for the input after it.
 */
export function trimLineEnds(snap: BlockSnapshot): BlockSnapshot {
  let charCount = 0;
  const lines = snap.lines.map((line) => {
    const runs = [...line.runs];
    while (runs.length > 0) {
      const last = runs[runs.length - 1]!;
      const text = last.text.replace(/\s+$/, '');
      if (text) {
        runs[runs.length - 1] = { ...last, text };
        break;
      }
      runs.pop();
    }
    for (const r of runs) charCount += r.text.length;
    return { runs };
  });
  return { ...snap, lines, charCount };
}
const MAX_COMMAND_ROWS = 40;

export interface TrackerEvents {
  onBlockStarted(block: CommandBlock): void;
  onBlockFinished(block: CommandBlock): void;
  onPhase?(phase: ShellStateMachine['phase']): void;
  onCwd?(cwd: string): void;
  onAnomaly?(reason: string): void;
}

export interface TrackerSession {
  sessionId: string;
  nonce: string;
  env: EnvironmentRef;
  shell: ShellKind;
}

/**
 * Turns shell-integration sequences into command blocks while the PTY stream keeps flowing
 * into the one real terminal. OSC handlers run synchronously while xterm parses, so the
 * markers they place and the buffer they read line up exactly with the bytes that triggered them.
 */
export class BlockTracker {
  readonly sm = new ShellStateMachine();
  private marker: MarkerLike | undefined;
  private current: CommandBlock | undefined;
  private altSeen = false;
  private pendingPrompt: BlockSnapshot | undefined;
  private seq = 0;
  private disposables: Disposable[] = [];

  constructor(
    private readonly term: TrackerTerm,
    private session: TrackerSession,
    private readonly events: TrackerEvents,
    private readonly now: () => number = Date.now
  ) {
    for (const id of [OSC_MARK, OSC_ARCTRI]) {
      this.disposables.push(term.parser.registerOscHandler(id, (data) => this.handle(id, data)));
    }
    this.disposables.push(
      term.buffer.onBufferChange((b) => {
        if (b.type === 'alternate' && this.current) this.altSeen = true;
      })
    );
  }

  update(session: Partial<TrackerSession>): void {
    this.session = { ...this.session, ...session };
  }

  private handle(id: number, data: string): boolean {
    const ev = parseOsc(id, data, this.session.nonce);
    if (!ev) return false; // not ours (or forged): let xterm treat it as an ordinary OSC
    // The shell has echoed the command but has not wiped the screen yet: this is the one moment the prompt and the command are both on it.
    if (ev.t === 'commandLine') this.pendingPrompt = this.promptSnapshot(MAX_COMMAND_ROWS, true);
    const tr = this.sm.apply(ev, this.now());
    if (ev.t === 'cwd') this.events.onCwd?.(this.sm.cwd ?? '');
    this.handleTransition(tr);
    this.events.onPhase?.(this.sm.phase);
    return true;
  }

  private handleTransition(tr: Transition): void {
    switch (tr.kind) {
      case 'blockStarted': {
        this.marker?.dispose();
        this.marker = this.term.registerMarker(0);
        this.altSeen = this.term.buffer.active.type === 'alternate';
        const cwd = this.cwdPath();
        const block: CommandBlock = {
          id: `${this.session.sessionId}:${++this.seq}`,
          sessionId: this.session.sessionId,
          ...(tr.command.commandId !== undefined ? { commandId: tr.command.commandId } : {}),
          command: tr.command.text,
          ...(cwd ? { cwd } : {}),
          env: this.session.env,
          shell: this.session.shell,
          status: 'running',
          startedAt: tr.command.startedAt,
          usedAltScreen: false,
          collapsed: false,
          ...(this.pendingPrompt ? { prompt: this.pendingPrompt } : {})
        };
        this.pendingPrompt = undefined;
        this.current = block;
        this.events.onBlockStarted({ ...block });
        break;
      }
      case 'blockFinished': {
        const block = this.current;
        this.current = undefined;
        if (!block) break;
        const finished: CommandBlock = {
          ...block,
          status: tr.status === 'failed' && (tr.exitCode === 130 || tr.exitCode === -1073741510) ? 'interrupted' : tr.status,
          endedAt: tr.endedAt,
          usedAltScreen: this.altSeen,
          output: this.capture()
        };
        if (tr.exitCode !== undefined) finished.exitCode = tr.exitCode;
        this.marker?.dispose();
        this.marker = undefined;
        this.events.onBlockFinished(finished);
        break;
      }
      case 'anomaly':
        this.events.onAnomaly?.(tr.reason);
        break;
      case 'none':
        break;
    }
  }

  private cwdPath(): EnvPath | undefined {
    const p = this.sm.cwd;
    if (!p) return undefined;
    const env = this.session.env;
    return env.kind === 'windows'
      ? { env: 'windows', path: p as never }
      : env.kind === 'local'
        ? { env: 'local', path: p as never }
        : { env: 'wsl', distro: env.distro, path: p as never };
  }

  /** Output of the command that just ended: from its marker to the cursor, normal buffer only. */
  private capture(): BlockSnapshot {
    const buf = this.term.buffer.normal;
    const cursorRow = buf.baseY + buf.cursorY;
    const end = buf.cursorX === 0 ? cursorRow : cursorRow + 1;
    const gone = !this.marker || this.marker.isDisposed || this.marker.line < 0;
    const start = gone ? 0 : this.marker!.line;
    return snapshotRange(buf, start, end, gone);
  }

  /** The rows from the top of the screen to the cursor: the prompt (and whatever is typed after it). */
  promptSnapshot(maxLines = MAX_PROMPT_LINES, dropTrailingEmpty = false): BlockSnapshot | undefined {
    const buf = this.term.buffer.normal;
    const end = buf.baseY + buf.cursorY + 1;
    const snap = trimLineEnds(snapshotRange(buf, buf.baseY, end));
    // After Enter the cursor has moved to the row below the command.
    if (dropTrailingEmpty) while (snap.lines.length > 1 && snap.lines[snap.lines.length - 1]!.runs.length === 0) snap.lines.pop();
    if (snap.charCount === 0) return undefined;
    if (snap.lines.length <= maxLines) return snap;
    return { ...snap, lines: snap.lines.slice(-maxLines) };
  }

  /** The PTY closed while a command was running. */
  closed(): void {
    this.handleTransition(this.sm.closed(this.now()));
    this.events.onPhase?.(this.sm.phase);
  }

  dispose(): void {
    this.marker?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

import { AgentScroll, measureShift, scrollCue } from './agent-scroll';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import type { CommandBlock } from '@shared/types/block';
import { AGENT_META } from '@shared/agents/meta';
import { INITIAL_PTY_SIZE, type SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { clipboardImageThumb, copyText, readClipboard } from '@/lib/clipboard';
import { tNow } from '@/lib/i18n';
import { commandForKey } from '../../commands/registry';
import { chordLetter } from '../../commands/keys';
import { useAgentStatus } from '@/stores/agent-status';
import { useAttachments } from '@/stores/attachments';
import { useBlocks } from '@/stores/blocks';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { isMac, isWindows, modKey } from '@/lib/platform';
import { planRemovalRows, type MessageRow, type RemovalPlan, type RowCell } from '../agents/attachment-remove';
import { inputRegion, numberOf, placeholdersIn, reconcile, type TrackedAttachment } from '../agents/attachment-tracker';
import { insertAttachments } from '../agents/insert';
import { refreshChanges } from '../agents/useChanges';
import { BlockTracker } from './block-tracker';
import { ThaiInputTracker } from './thai-input';
import { TERMINAL_FONT, TERMINAL_LETTER_SPACING, terminalFontsReady, terminalTheme } from './theme';

/** An unfocused pane must not look like the one receiving keys: hollow block, or no bar/underline at all. */
const inactiveCursor = (s: 'bar' | 'block' | 'underline') => (s === 'block' ? ('outline' as const) : ('none' as const));

/** `localStorage.arctriTraceAttach = '1'` in the DevTools console logs how an attachment is removed from the agent's message box. */
function traceAttach(...args: unknown[]): void {
  try {
    if (localStorage.getItem('arctriTraceAttach')) console.info('[attach-remove]', ...args);
  } catch {
    /* no storage */
  }
}

/** Key chords handled by the app; xterm must not forward them to the shell. */
function isAppChord(e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return false;
  if (commandForKey(e)) return true; // every shortcut of the app comes from the command registry
  const k = chordLetter(e);
  if ((isMac ? !e.shiftKey : e.shiftKey) && modKey(e) && k === 'n') return true;
  if (modKey(e) && !e.shiftKey && (k === 'arrowup' || k === 'arrowdown')) return true; // block navigation
  return false;
}

export class TerminalHost {
  readonly term: Terminal;
  readonly element: HTMLDivElement;
  readonly tracker: BlockTracker;
  private fit = new FitAddon();
  private thaiInput = new ThaiInputTracker();
  private webgl: WebglAddon | undefined;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubData: () => void;
  private observer: ResizeObserver;
  private disposed = false;
  private lastClassicBlock: { block: CommandBlock; text: string } | undefined;
  lastOutputText = '';

  constructor(public info: SessionInfo) {
    const ui = useUi.getState();
    const dark = ui.prefs.theme === 'dark';
    this.element = document.createElement('div');
    this.element.className = 'xterm-host';
    this.term = new Terminal({
      allowProposedApi: true,
      cols: INITIAL_PTY_SIZE.cols,
      rows: INITIAL_PTY_SIZE.rows,
      customGlyphs: true,
      rescaleOverlappingGlyphs: true,
      fontFamily: TERMINAL_FONT,
      fontSize: ui.prefs.fontSize,
      letterSpacing: TERMINAL_LETTER_SPACING,
      scrollback: ui.prefs.scrollback,
      cursorBlink: true,
      cursorStyle: ui.prefs.cursorStyle,
      cursorInactiveStyle: inactiveCursor(ui.prefs.cursorStyle),
      theme: terminalTheme(dark),
      ...(isWindows ? { windowsPty: { backend: 'conpty' as const, buildNumber: ui.windowsBuild } } : {}),
      macOptionIsMeta: false,
      rightClickSelectsWord: false,
      allowTransparency: false
    });

    this.term.loadAddon(this.fit);
    this.term.loadAddon(
      new WebLinksAddon((e, uri) => {
        if (e.ctrlKey || e.metaKey) void api.app.openExternal(uri);
      })
    );
    const uni = new Unicode11Addon();
    this.term.loadAddon(uni);
    this.term.unicode.activeVersion = '11';

    // OSC 52 (program-initiated clipboard writes) is off unless the user enabled it.
    this.term.parser.registerOscHandler(52, (data) => {
      if (!useUi.getState().prefs.osc52) return true;
      const text = data.split(';')[1];
      if (text && text !== '?') {
        try {
          const bin = atob(text);
          void copyText(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
        } catch {
          /* ignore malformed payload */
        }
      }
      return true;
    });

    this.tracker = new BlockTracker(
      this.term,
      { sessionId: info.id, nonce: info.nonce, env: info.env, shell: info.shell },
      {
        onBlockStarted: (b) => useBlocks.getState().add(b),
        onBlockFinished: (b) => {
          useBlocks.getState().replace(b);
          refreshChanges(info.id);
          this.lastClassicBlock = { block: b, text: '' };
          this.lastOutputText = b.output ? b.output.lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n') : '';
          this.decorate(b);
        },
        onPhase: (p) => {
          useSessions.getState().setUiPhase(info.id, p);
          if (p === 'editing') this.capturePromptSoon();
        }
      }
    );
    // The shell draws its prompt after it has said where the prompt is, so it is read once the drawing has been parsed.
    this.term.onWriteParsed(() => {
      this.syncScrollbar();
      this.scrollHintSoon();
      if (this.awaitingRedraw) this.redrawArrived();
      if (this.tracker.sm.phase === 'editing') this.capturePromptSoon();
      this.trackAttachmentsSoon();
    });
    this.element.addEventListener('dragover', (e) => {
      if (this.isAgent() && e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    this.element.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!this.isAgent() || !files.length) return;
      e.preventDefault();
      void api.files.fromDrop(info.id, files).then((atts) => insertAttachments(info.id, atts));
    });

    // Claude Code's fullscreen screen scrolls itself: what is sent to it feeds an estimate that the scroll indicator draws.
    this.element.addEventListener(
      'wheel',
      (e) => {
        if (!this.scrollHintOn() || e.deltaY === 0) return;
        this.agentScroll.wheel(Math.sign(e.deltaY));
        this.scrollInput();
        this.scrollHintSoon(60);
      },
      // capture: xterm handles the wheel itself and stops it from bubbling
      { passive: true, capture: true }
    );

    this.term.attachCustomKeyEventHandler((e) => this.onKey(e));
    this.term.onData((d) => {
      this.thaiInput.feed(d);
      api.sessions.write(info.id, d);
    });
    // Only real key presses count here: onData also carries the terminal's own replies and focus reports.
    // Esc / Ctrl+C while it works or asks for approval, or Enter after a finished turn (the main process decides what that means per agent).
    this.term.onKey(({ domEvent: e }) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
      const st = useAgentStatus.getState().byId[this.info.id]?.state;
      const interrupt = e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'c');
      if ((st === 'needs-approval' || st === 'working') && interrupt) void api.agentStatus.input(this.info.id, 'interrupt');
      else if (st === 'finished' && e.key === 'Enter') void api.agentStatus.input(this.info.id, 'submit');
    });
    this.term.onResize(() => {
      this.syncScrollbar();
      this.syncPtySize();
    });
    this.term.onBell(() => this.agentSignal('', ''));
    // OSC 9 (message) and OSC 777 (notify;title;body): how agent CLIs ask for attention. OSC 9;4 is progress, not a message.
    this.term.parser.registerOscHandler(9, (data) => {
      if (!/^\d+(;|$)/.test(data)) this.agentSignal('', data);
      return true;
    });
    this.term.parser.registerOscHandler(777, (data) => {
      const [kind, title = '', ...body] = data.split(';');
      if (kind === 'notify') this.agentSignal(title, body.join(';'));
      return true;
    });

    this.unsubData = api.sessions.onData(info.id, (chunk) => {
      // Output that arrives after the terminal is gone is dropped; its acknowledgement still goes out, or the main process
      // would wait for it and keep the PTY paused.
      if (this.disposed) {
        api.sessions.ack(info.id, chunk.length);
        return;
      }
      this.term.write(chunk, () => api.sessions.ack(info.id, chunk.length));
    });

    this.observer = new ResizeObserver(() => this.scheduleFit());
    this.observer.observe(this.element);
  }

  private promptTimer: ReturnType<typeof setTimeout> | undefined;

  private capturePromptSoon(): void {
    clearTimeout(this.promptTimer);
    this.promptTimer = setTimeout(() => {
      const id = this.info.id;
      // Nothing typed yet: the command is reported as soon as it is submitted.
      if (this.tracker.sm.phase !== 'editing' || this.tracker.sm.current) return;
      // While the size is settling the prompt rows may be mangled (see redrawPromptSoon); it is read after the clean redraw instead.
      if (this.resizeSettling) return;
      useSessions.getState().setPrompt(id, this.tracker.promptSnapshot());
    }, 40);
  }

  private lastSignalAt = 0;

  /**
   * A bell or notification from the program. Only a tab that runs an agent may raise one, and it is only a hint:
   * the main process records it as "unknown, low confidence". What the agent is really doing comes from its hooks.
   */
  private agentSignal(_title: string, _body: string): void {
    const info = this.info;
    if (info.kind !== 'agent' && !info.runningAgent) return;
    const now = Date.now();
    if (now - this.lastSignalAt < 10_000) return;
    this.lastSignalAt = now;
    void api.agentStatus.signal(info.id);
  }

  mount(parent: HTMLElement): void {
    const moved = !!this.element.parentElement && this.element.parentElement !== parent;
    if (this.element.parentElement !== parent) parent.appendChild(this.element);
    // a terminal moved to another group of the grid is drawn again at its new size
    if (moved) requestAnimationFrame(() => requestAnimationFrame(() => { this.fitNow(); this.repaint(); }));
    if (!this.term.element) {
      this.term.open(this.element);
      this.enableWebgl();
      this.redrawWhenFontsReady();
    }
    this.scheduleFit(0);
  }

  /** Glyphs drawn before a font arrived stay in the texture atlas in the fallback face; draw them again once it is there. */
  private redrawWhenFontsReady(): void {
    void terminalFontsReady().then(() => {
      if (this.disposed || !this.term.element) return;
      this.term.clearTextureAtlas();
      this.fitNow();
    });
  }

  private enableWebgl(): void {
    if (this.webgl || this.disposed) return;
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => {
        gl.dispose();
        if (this.webgl === gl) this.webgl = undefined;
        this.repaint();
      });
      this.term.loadAddon(gl);
      this.webgl = gl;
      this.repaint();
      this.redrawWhenFontsReady();
    } catch (e) {
      console.warn('[terminal] WebGL renderer unavailable, using the DOM renderer', e);
      this.webgl = undefined; // falls back to the DOM renderer
    }
  }

  /** A renderer swapped in or a canvas shown again can hold a stale or half-built glyph atlas (garbled text); rebuild it and repaint. */
  private repaint(): void {
    if (this.disposed || !this.term.element) return;
    this.term.clearTextureAtlas();
    if (this.term.rows > 0) this.term.refresh(0, this.term.rows - 1);
  }

  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private active = false;

  /** Browsers allow only a handful of WebGL contexts, so tabs left in the background give theirs up. */
  setActive(active: boolean): void {
    clearTimeout(this.idleTimer);
    this.active = active;
    if (active) {
      this.enableWebgl();
      this.scheduleFit(0);
      // fit() does not repaint when cols/rows are unchanged, so repaint once layout and paint have settled.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!this.active) return;
          this.fitNow();
          this.repaint();
        }),
      );
    } else {
      this.idleTimer = setTimeout(() => {
        this.webgl?.dispose();
        this.webgl = undefined;
      }, 60_000);
    }
  }

  update(info: SessionInfo): void {
    const wasCapped = this.promptCapped();
    this.info = info;
    this.tracker.update({ env: info.env, shell: info.shell });
    // an agent starting or ending in a shell tab lifts or restores the prompt's column cap: refit at once
    if (this.promptCapped() !== wasCapped) this.scheduleFit(0);
  }

  /**
   * readline in bash takes a Thai consonant together with its vowel or tone mark on Backspace.
   * Sending the rest of the cluster again after the delete leaves the consonant behind, as zsh and PowerShell already do.
   */
  private thaiBackspace(): string | undefined {
    const info = this.info;
    if (info.kind !== 'shell' || info.runningAgent || info.shell !== 'bash' || this.tracker.sm.phase !== 'editing') return undefined;
    const buf = this.term.buffer.active;
    if (buf.type !== 'normal' || buf.cursorX < 1) return undefined;
    const chars = buf.getLine(buf.cursorY + buf.viewportY)?.getCell(buf.cursorX - 1)?.getChars() ?? '';
    return /^[\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46][\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]+$/.test(chars) ? chars.slice(0, -1) : undefined;
  }

  private onKey(e: KeyboardEvent): boolean {
    if (isAppChord(e)) return false;
    if (e.type !== 'keydown') return true;
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && ['PageUp', 'PageDown'].includes(e.key) && this.scrollHintOn()) {
      this.agentScroll.key(e.key);
      this.scrollInput();
      this.scrollHintSoon(80);
    }
    if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const agent = this.info.kind === 'agent' || !!this.info.runningAgent;
      const rest = agent ? this.thaiInput.backspace() : this.thaiBackspace();
      if (rest !== undefined) {
        api.sessions.write(this.info.id, '\x7f' + rest);
        return false;
      }
    }
    const k = chordLetter(e);
    // The agent pastes an image from the clipboard with its own key. It is let through; the preview is taken from the same clipboard.
    if (this.isAgent() && k === 'v' && ((e.altKey && !e.ctrlKey) || (isMac && e.ctrlKey))) this.snapshotAgentPaste();
    if (isMac) {
      // Cmd+C copies the selection and Cmd+V pastes; Ctrl+C is always the shell's interrupt
      if (e.metaKey && k === 'c') {
        this.copySelection();
        return false;
      }
      if (e.metaKey && k === 'v') {
        e.preventDefault(); // the browser's own paste event must not add a second paste
        void this.pasteFromClipboard();
        return false;
      }
      return true;
    }
    if (e.ctrlKey && k === 'c' && (e.shiftKey || this.term.hasSelection())) {
      if (this.term.hasSelection()) {
        void copyText(this.term.getSelection());
        this.term.clearSelection();
        return false;
      }
      return !e.shiftKey;
    }
    if (e.ctrlKey && k === 'v') {
      e.preventDefault();
      void this.pasteFromClipboard();
      return false;
    }
    return true;
  }

  copySelection(): void {
    if (!this.term.hasSelection()) return;
    void copyText(this.term.getSelection());
    this.term.clearSelection();
  }

  selectAll(): void {
    this.term.selectAll();
  }

  private isAgent(): boolean {
    const info = useSessions.getState().infos[this.info.id] ?? this.info;
    return info.kind === 'agent' || !!info.runningAgent;
  }

  /** The rows of the live screen as text. */
  screenLines(): string[] {
    const b = this.term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < this.term.rows; i++) lines.push(b.getLine(b.baseY + i)?.translateToString(true) ?? '');
    return lines;
  }

  /** The characters of one row of the live screen, with where the caret may be drawn. */
  private rowCells(y: number): RowCell[] {
    const line = this.term.buffer.active.getLine(this.term.buffer.active.baseY + y);
    const cells: RowCell[] = [];
    for (let x = 0; line && x < line.length; x++) {
      const c = line.getCell(x);
      if (!c || c.getWidth() === 0) continue;
      cells.push({ x, ch: c.getChars() || ' ', inverse: !!c.isInverse() });
    }
    return cells;
  }

  /** Where the caret stands relative to `needle` in the message box right now (see `planRemovalRows`); undefined when that is unclear. */
  private locate(needle: string, occurrence = 0): RemovalPlan | undefined {
    const info = useSessions.getState().infos[this.info.id] ?? this.info;
    const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
    const input = agentId ? AGENT_META[agentId]?.input : undefined;
    if (!input) return undefined;
    const lines = this.screenLines();
    const region = inputRegion(lines, input.prompt);
    if (region === undefined) return undefined;
    const buf = this.term.buffer.active;
    // all rows of the message box: a long @path is wrapped over more than one
    const rows: MessageRow[] = [];
    for (let y = lines.length - region.split('\n').length; y < lines.length; y++) {
      rows.push({ cells: this.rowCells(y), cursorX: y === buf.cursorY ? buf.cursorX : undefined });
    }
    return planRemovalRows(rows, needle, occurrence);
  }

  /** How many times `text` is in the message box now; spaces and wraps are ignored. */
  private countInMessage(text: string): number {
    const info = useSessions.getState().infos[this.info.id] ?? this.info;
    const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
    const input = agentId ? AGENT_META[agentId]?.input : undefined;
    const region = input ? inputRegion(this.screenLines(), input.prompt) : undefined;
    if (region === undefined) return 0;
    const flat = region.replace(/\s/g, '');
    const needle = text.replace(/\s/g, '');
    let n = 0;
    for (let at = flat.indexOf(needle); at >= 0; at = flat.indexOf(needle, at + needle.length)) n++;
    return n;
  }

  /** Reads `read()` until it gives the same caret distance twice in a row (the agent has drawn every key sent), at most 1.5s. */
  private async settled(read: () => RemovalPlan | undefined): Promise<RemovalPlan | undefined> {
    let last = read();
    for (const end = Date.now() + 1500; Date.now() < end; ) {
      await new Promise((r) => setTimeout(r, 60));
      const now = read();
      if (now?.moves === last?.moves) return now;
      last = now;
    }
    return last;
  }

  private async until(cond: () => boolean, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 30));
    return cond();
  }

  /**
   * Takes an attachment out of the agent's message box. The caret is moved one key at a time and looked at after each key, and
   * Backspace is pressed only once the caret is seen right behind the text. If anything is unclear (the caret does not move,
   * the screen does not answer) nothing is deleted and false is returned. `occurrence` picks one of several identical `@path`s
   * (the same file attached twice), counted in reading order. Removals run one after another: two at once would mix their keys.
   */
  removeAttachment(att: TrackedAttachment, occurrence = 0): Promise<boolean> {
    const run = this.removing.then(() => this.removeAttachmentNow(att, occurrence));
    this.removing = run.catch(() => false);
    return run;
  }

  private removing: Promise<unknown> = Promise.resolve();

  private async removeAttachmentNow(att: TrackedAttachment, occurrence: number): Promise<boolean> {
    const info = useSessions.getState().infos[this.info.id] ?? this.info;
    if (info.state !== 'running') return false;
    const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
    const input = agentId ? AGENT_META[agentId]?.input : undefined;
    const tokens = () => (input ? placeholdersIn(this.screenLines(), input) : []);
    const write = (d: string) => {
      traceAttach('key', JSON.stringify(d), 'rows', this.messageRows());
      api.sessions.write(this.info.id, d);
    };
    // a placeholder from the agent can be both the token and the ref of a chip: it is a token first
    for (const needle of new Set([att.token, att.ref].filter((n): n is string => !!n))) {
      // placeholders are unique; only a path can be in the message more than once
      const nth = needle === att.token ? 0 : occurrence;
      const first = this.locate(needle, nth);
      traceAttach('start', needle, first, 'cursor', this.term.buffer.active.cursorX, this.term.buffer.active.cursorY, 'rows', this.messageRows());
      if (!first) continue;
      let plan: RemovalPlan = first;
      // a long path is many keys away when the caret is at the other end of the message
      let stalls = 0;
      for (let i = 0; i < 100 && plan.moves !== 0; i++) {
        const before: number = plan.moves;
        // far away: most of the way in one go (the distance across rows is only an estimate, so stop a little short and let
        // the single keys after it settle the rest); close by: one key at a time
        const keys: number = Math.abs(before) > 6 ? Math.abs(before) - 3 : 1;
        write((before > 0 ? '\x1b[C' : '\x1b[D').repeat(keys));
        // an agent may jump over a whole placeholder with one key: only the screen tells where the caret is
        await this.until(() => this.locate(needle, nth)?.moves !== before, 400);
        const next: RemovalPlan | undefined = keys > 1 ? await this.settled(() => this.locate(needle, nth)) : this.locate(needle, nth);
        if (!next) {
          traceAttach('lost', needle, 'rows', this.messageRows());
          return false;
        }
        // the space a wrap swallowed is drawn where the next row starts, so one key over it shows no change on screen;
        // only several keys in a row without a change mean the caret is really stuck
        if (next.moves === before && ++stalls > 2) {
          traceAttach('stuck', needle, { before }, 'cursor', this.term.buffer.active.cursorX, this.term.buffer.active.cursorY, 'rows', this.messageRows());
          return false;
        }
        if (next.moves !== before) stalls = 0;
        plan = next;
      }
      if (plan.moves !== 0) {
        traceAttach('too far', needle, plan);
        return false;
      }
      if (needle !== att.token) {
        const had = this.countInMessage(needle);
        write('\x7f'.repeat(plan.width));
        const gone = await this.until(() => this.countInMessage(needle) < had, 1000);
        traceAttach('after', { gone }, 'rows', this.messageRows());
        return gone;
      }
      // a placeholder is one unit for the agent: a single Backspace, never a second one (it would eat the text before it)
      const others = tokens().filter((t) => t !== needle);
      write('\x7f');
      const gone = await this.until(() => !this.screenLines().some((l) => l.includes(needle)), 1000);
      await new Promise((r) => setTimeout(r, 300));
      const now = tokens();
      const lost = others.filter((t) => !now.includes(t));
      traceAttach('after', { gone, lost }, 'rows', this.messageRows());
      if (lost.length) useUi.getState().toast(tNow('agent.attachmentRemovedMore', { lost: lost.join(' ') }));
      return gone;
    }
    return false;
  }

  /** The rows of the message box (for the trace). */
  private messageRows(): string[] {
    const lines = this.screenLines();
    const info = useSessions.getState().infos[this.info.id] ?? this.info;
    const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
    const input = agentId ? AGENT_META[agentId]?.input : undefined;
    const region = input ? inputRegion(lines, input.prompt) : undefined;
    return region === undefined ? lines.slice(-4) : region.split('\n');
  }

  private thumbTries = new Map<string, { tries: number; at: number; done: boolean }>();

  /**
   * Claude Code saves a pasted image as a file the moment it is pasted. Its preview is taken from there, which is exact for
   * `[Image #N]` and needs no clipboard. The file may not be there yet, so it is asked for again (a few times, every 300ms or so).
   */
  private loadThumbs(list: TrackedAttachment[]): void {
    const info = useSessions.getState().infos[this.info.id] ?? this.info;
    const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
    const live = new Set(list.map((a) => a.token).filter((t): t is string => !!t));
    for (const t of this.thumbTries.keys()) if (!live.has(t)) this.thumbTries.delete(t);
    if (agentId !== 'claude-code') return;
    for (const a of list) {
      const n = numberOf(a);
      if (!a.token || !a.image || !n) continue;
      const st = this.thumbTries.get(a.token) ?? { tries: 0, at: 0, done: false };
      if (st.done || st.tries >= 17 || Date.now() - st.at < 300) continue;
      this.thumbTries.set(a.token, { ...st, tries: st.tries + 1, at: Date.now() });
      const token = a.token;
      const agentSessionId = useAgentStatus.getState().byId[this.info.id]?.agentSessionId;
      void api.files.pastedImage(this.info.id, n, agentSessionId).then(
        (img) => {
          if (!img) return;
          this.thumbTries.set(token, { tries: 17, at: Date.now(), done: true });
          const cur = useAttachments.getState().bySession[this.info.id] ?? [];
          useAttachments.getState().set(this.info.id, cur.map((x) => (x.token === token ? { ...x, thumb: img.thumb, src: img.src } : x)));
        },
        () => undefined
      );
    }
  }

  private attachTimer: ReturnType<typeof setTimeout> | undefined;
  /** Previews of images the agent pasted itself, waiting for their placeholder to show up in the message box. */
  private agentPastes: Array<{ name: string; thumb?: string; at: number }> = [];
  private watchUntil = 0;

  private snapshotAgentPaste(): void {
    this.watchUntil = Date.now() + 5000;
    void clipboardImageThumb().then((img) => img && this.rememberPreview(img));
  }

  /** Keeps the preview of an image the agent pastes itself until its placeholder shows in the message box. */
  private rememberPreview(img: { name: string; thumb: string }): void {
    // the placeholder may already be showing (the agent is quicker): give its chip the preview
    const store = useAttachments.getState();
    const bare = (store.bySession[this.info.id] ?? []).find((x) => x.id.startsWith('token-') && !x.thumb);
    if (bare) store.set(this.info.id, (store.bySession[this.info.id] ?? []).map((x) => (x === bare ? { ...x, thumb: img.thumb } : x)));
    else this.agentPastes.push({ ...img, at: Date.now() });
    this.trackAttachmentsSoon();
  }

  /** Ctrl+V with an image on the clipboard: the agent's own paste key is sent, as if it had been pressed in the agent. */
  private pasteImageIntoAgent(img: { name: string; thumb: string }): void {
    const info = useSessions.getState().infos[this.info.id] ?? this.info;
    const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
    const key = agentId ? AGENT_META[agentId]?.pasteImageKey(info.env.kind) : undefined;
    if (!key) return;
    this.watchUntil = Date.now() + 5000;
    this.rememberPreview(img);
    api.sessions.write(this.info.id, key);
  }

  /** The preview in the agent bar keeps only what the message box still holds (it is looked at once the output has settled). */
  private trackAttachmentsSoon(): void {
    const store = useAttachments.getState();
    if ((!store.bySession[this.info.id]?.length && Date.now() > this.watchUntil) || this.attachTimer) return;
    this.attachTimer = setTimeout(() => {
      this.attachTimer = undefined;
      const info = useSessions.getState().infos[this.info.id] ?? this.info;
      const list = useAttachments.getState().bySession[this.info.id] ?? [];
      if (!list.length && Date.now() > this.watchUntil) return;
      const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
      const input = agentId ? AGENT_META[agentId]?.input : undefined;
      if (!input || info.state !== 'running') return void useAttachments.getState().clear(this.info.id);
      this.agentPastes = this.agentPastes.filter((p) => Date.now() - p.at < 15000);
      const next = reconcile(this.screenLines(), list, input, Date.now(), () => this.agentPastes.shift());
      if (next !== list && (next.length || list.length)) useAttachments.getState().set(this.info.id, next);
      this.loadThumbs(next);
    }, 120);
  }

  private pasting = false;

  async pasteFromClipboard(): Promise<void> {
    if (this.pasting) return; // one paste at a time: a second one while the clipboard is being read would paste the image twice
    this.pasting = true;
    try {
      await this.pasteNow();
    } finally {
      this.pasting = false;
    }
  }

  private async pasteNow(): Promise<void> {
    if (this.isAgent()) {
      const files = await api.files.clipboard(this.info.id).catch(() => []);
      if (files.length) return insertAttachments(this.info.id, files);
      const img = await clipboardImageThumb();
      if (img) return this.pasteImageIntoAgent(img);
    }
    const text = await readClipboard();
    if (!text) return;
    const lines = text.split(/\r\n|\r|\n/).length;
    // Without bracketed paste the shell would run each pasted line; ask first.
    if (lines > 1 && !this.term.modes.bracketedPasteMode && !window.confirm(tNow('paste.confirm', { lines }))) return;
    this.term.paste(text);
  }

  private scheduleFit(delay = 50): void {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.fitNow(), delay);
  }

  fitNow(): void {
    if (this.disposed || !this.term.element) return;
    const el = this.element;
    if (el.offsetWidth < 20 || el.offsetHeight < 20) return; // hidden tab
    try {
      const dims = this.fit.proposeDimensions();
      if (dims && Number.isFinite(dims.cols) && Number.isFinite(dims.rows)) {
        const cols = Math.max(2, Math.min(dims.cols, this.promptCols(el.clientWidth)));
        if (cols !== this.term.cols || dims.rows !== this.term.rows) this.term.resize(cols, dims.rows);
      }
    } catch {
      /* not laid out yet */
    }
    // onResize only fires when xterm's own size changes; the PTY may still be at its spawn size, so tell it after every fit.
    this.syncPtySize();
  }

  private cellProbe: { key: string; width: number } | undefined;

  /**
   * Block mode draws the prompt as HTML (CommandEditor), 16px in from each side, in the terminal face. A prompt of N columns needs
   * N advances of that face; asking for more than fits makes its right-aligned part run off the edge. Infinity outside block mode.
   */
  private promptCols(paneWidth: number): number {
    if (!this.promptCapped()) return Infinity;
    const font = `${this.term.options.fontSize ?? 14}px ${TERMINAL_FONT}`;
    // measured again until the face is really loaded: a fallback face has another advance
    if (this.cellProbe?.key !== font || !document.fonts.check(font)) {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return Infinity;
      ctx.font = font;
      this.cellProbe = { key: font, width: ctx.measureText('M').width };
      this.overflowCols = 0;
    }
    // the overflow was measured at one width; at another the prompt is redrawn and the editor measures it again
    if (paneWidth !== this.overflowAt) {
      this.overflowAt = paneWidth;
      this.overflowCols = 0;
    }
    const w = this.cellProbe.width;
    return w > 0 ? Math.floor((paneWidth - 32 - 2) / w) - this.overflowCols : Infinity;
  }

  /**
   * xterm 6 draws its own overlay scrollbar and fades it out until the wheel or the pointer touches it, so it looks missing. While
   * there is scrollback to scroll through it is kept visible (CSS on `has-scrollback`); the alternate screen has none.
   */
  private syncScrollbar(): void {
    const b = this.term.buffer.active;
    this.element.classList.toggle('has-scrollback', b.type === 'normal' && b.baseY > 0);
  }

  private readonly agentScroll = new AgentScroll();
  private scrollBar: { root: HTMLDivElement; thumb: HTMLDivElement } | undefined;
  private scrollHintTimer: ReturnType<typeof setTimeout> | undefined;
  private scrollDrag: { grab: number; targetTop: number; timer: ReturnType<typeof setInterval> } | undefined;

  /** The bar is for an agent on the fullscreen (alternate) screen, which has no scrollback and so no xterm scrollbar. */
  private scrollHintOn(): boolean {
    return this.isAgent() && this.term.buffer.active.type === 'alternate';
  }

  /** Reads the screen after `delay`: Claude draws what a wheel turn did a moment later, so it is not read at once. */
  private scrollHintSoon(delay = 100): void {
    if (this.scrollHintTimer) return;
    this.scrollHintTimer = setTimeout(() => {
      this.scrollHintTimer = undefined;
      if (!this.disposed) this.updateScrollHint();
    }, delay);
  }

  private trackHeight(): number {
    return Math.max(0, this.element.clientHeight - 6);
  }

  /** What a click or drag on the bar does: the agent only understands paging keys, so the bar sends those. */
  private sendPages(pages: number): void {
    const up = pages > 0;
    for (let i = 0; i < Math.min(3, Math.abs(pages)); i++) {
      api.sessions.write(this.info.id, up ? '\x1b[5~' : '\x1b[6~');
      this.agentScroll.key(up ? 'PageUp' : 'PageDown');
    }
    this.scrollInput();
  }

  private buildScrollBar(): { root: HTMLDivElement; thumb: HTMLDivElement } {
    const root = document.createElement('div');
    root.className = 'agent-scroll';
    const thumb = document.createElement('div');
    thumb.className = 'agent-scroll-thumb';
    root.appendChild(thumb);
    this.element.appendChild(root);

    const trackTop = () => root.getBoundingClientRect().top;
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.scrollHintOn()) return;
      e.preventDefault();
      const t = this.agentScroll.thumb(this.trackHeight(), this.term.rows);
      const y = e.clientY - trackTop();
      if (y >= t.top && y <= t.top + t.height) {
        // dragging: the thumb follows the pointer, and the pages that would take the transcript there are sent
        root.setPointerCapture(e.pointerId);
        root.classList.add('dragging');
        const drag = {
          grab: y - t.top,
          targetTop: t.top,
          timer: setInterval(() => this.dragTick(), 70)
        };
        this.scrollDrag = drag;
      } else {
        this.sendPages(y < t.top ? 1 : -1);
        this.scrollHintSoon(80);
      }
    });
    root.addEventListener('pointermove', (e) => {
      if (this.scrollDrag) this.scrollDrag.targetTop = e.clientY - trackTop() - this.scrollDrag.grab;
    });
    const end = () => {
      if (!this.scrollDrag) return;
      clearInterval(this.scrollDrag.timer);
      this.scrollDrag = undefined;
      root.classList.remove('dragging');
      this.scrollHintSoon(250);
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    return { root, thumb };
  }

  private dragTick(): void {
    const drag = this.scrollDrag;
    if (!drag || !this.scrollHintOn()) return;
    const track = this.trackHeight();
    const t = this.agentScroll.thumb(track, this.term.rows);
    let pages = this.agentScroll.pagesTo(drag.targetTop, track, this.term.rows);
    // held at the very bottom: go on until the agent itself says it is there
    if (pages === 0 && drag.targetTop >= track - t.height - 2 && this.agentScroll.isScrolledUp) pages = -1;
    if (pages !== 0) this.sendPages(pages);
    this.readCue();
    this.updateScrollHint(false);
  }

  private lastScrollInput = 0;
  private scrollRegion: string[] | undefined;

  /** Notes that something was sent to scroll the agent: its answer (and the cue) is drawn a moment later. */
  private scrollInput(): void {
    this.lastScrollInput = Date.now();
  }

  /** Looks at the screen: the cue near the bottom, and how far the transcript text moved since the last look. */
  private readCue(): void {
    const buf = this.term.buffer.active;
    const all: string[] = [];
    for (let i = 0; i < this.term.rows; i++) all.push(buf.getLine(buf.viewportY + i)?.translateToString(true) ?? '');
    // the cue ends its row; transcript text that merely mentions it does not count
    const cues = all.slice(-14).map(scrollCue).filter((c): c is string => !!c);
    // the transcript area: above the input box and the lines under it
    const region = all.slice(0, Math.max(0, all.length - 10));
    const shift = this.scrollRegion ? measureShift(this.scrollRegion, region) : undefined;
    this.scrollRegion = region;
    const fresh = Date.now() - this.lastScrollInput < 600;
    this.agentScroll.screen(cues.join('\n'), shift, fresh);
    // a look that had to wait for the cue is made again once the agent has had time to draw it
    if (fresh && cues.length === 0) this.scrollHintSoon(350);
  }

  private updateScrollHint(readScreen = true): void {
    if (!this.scrollHintOn()) {
      this.agentScroll.reset();
      this.scrollBar?.root.remove();
      this.scrollBar = undefined;
      return;
    }
    if (readScreen) this.readCue();
    const bar = (this.scrollBar ??= this.buildScrollBar());
    const t = this.agentScroll.thumb(this.trackHeight(), this.term.rows);
    bar.root.classList.toggle('scrolled', t.scrolled);
    // while dragging, the thumb is under the pointer
    const top = this.scrollDrag ? Math.min(Math.max(0, this.scrollDrag.targetTop), Math.max(0, this.trackHeight() - t.height)) : t.top;
    bar.thumb.style.top = `${top}px`;
    bar.thumb.style.height = `${t.height}px`;
  }

  /** Only the HTML prompt of block mode limits the columns; an agent running in the tab owns the whole screen. */
  private promptCapped(): boolean {
    const info = this.info;
    return info.kind === 'shell' && !info.runningAgent && info.presentation === 'blocks' && info.integration === 'active';
  }

  private overflowCols = 0;
  private overflowAt = -1;

  /**
   * The HTML prompt can come out wider than N canvas-measured cells (symbol glyphs from a fallback face, rounding), which clips its
   * right edge. The editor reports how far it is cut off; the terminal then asks the shell for that many columns fewer.
   */
  reportPromptOverflow(px: number): void {
    const w = this.cellProbe?.width ?? 0;
    if (this.disposed || w <= 0 || px < 1) return;
    const extra = Math.min(40, Math.ceil(px / w));
    if (extra <= this.overflowCols) return;
    this.overflowCols = extra;
    this.scheduleFit(0);
  }

  private lastSent = `${INITIAL_PTY_SIZE.cols}x${INITIAL_PTY_SIZE.rows}`;
  private redrawTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeSettling = false;
  private awaitingRedraw = false;

  private redrawArrived(): void {
    clearTimeout(this.redrawTimer);
    this.awaitingRedraw = false;
    this.resizeSettling = false;
    this.capturePromptSoon();
  }

  /**
   * A narrower terminal re-wraps the shell's prompt rows, but the shell redraws it by moving up a fixed number of rows, so rows of the
   * old prompt stay behind (stacked prompts). Once the size has settled and the shell is only waiting for input, have it clear the screen
   * and draw the prompt again (Ctrl-L); in block mode the screen holds nothing but the prompt, so nothing is lost.
   */
  private redrawPromptSoon(): void {
    const info = this.info;
    if (info.kind !== 'shell' || info.presentation !== 'blocks' || info.integration !== 'active') return;
    clearTimeout(this.redrawTimer);
    this.resizeSettling = true;
    this.redrawTimer = setTimeout(() => {
      this.resizeSettling = false;
      const now = this.info;
      if (this.disposed || now.runningAgent) return;
      if (this.tracker.sm.phase !== 'editing' || this.tracker.sm.current || this.term.buffer.active.type !== 'normal') {
        this.capturePromptSoon();
        return;
      }
      // the clean redraw is on its way; the prompt is read as soon as the first of its output has been parsed (or after 400ms if none comes)
      this.awaitingRedraw = true;
      void api.sessions.write(now.id, '\x0c');
      this.redrawTimer = setTimeout(() => this.redrawArrived(), 400);
    }, 150);
  }

  /** Keeps the PTY (and the shell's $COLUMNS) at exactly the size xterm draws at; a mismatch wraps right-aligned prompts. */
  private syncPtySize(): void {
    if (this.disposed) return;
    const { cols, rows } = this.term;
    const key = `${cols}x${rows}`;
    if (key === this.lastSent) return;
    this.lastSent = key;
    void api.sessions.resize(this.info.id, cols, rows);
    this.redrawPromptSoon();
  }

  focus(): void {
    this.term.focus();
  }

  applyPrefs(fontSize: number, dark: boolean, cursorStyle: 'bar' | 'block' | 'underline' = 'bar'): void {
    if (this.term.options.cursorStyle !== cursorStyle) {
      this.term.options.cursorStyle = cursorStyle;
      this.term.options.cursorInactiveStyle = inactiveCursor(cursorStyle);
    }
    if (this.term.options.fontSize !== fontSize) this.term.options.fontSize = fontSize;
    this.term.options.theme = terminalTheme(dark);
    this.scheduleFit(0);
  }

  /** Classic presentation: draw a coloured strip beside each finished command. */
  private decorate(b: CommandBlock): void {
    if (this.info.presentation !== 'classic') return;
    const marker = this.term.registerMarker(-1);
    if (!marker) return;
    const dark = useUi.getState().prefs.theme === 'dark';
    const color = b.status === 'success' ? (dark ? '#7bc68f' : '#2e8b57') : b.status === 'unknown' ? (dark ? '#5a5a5a' : '#a6a6a6') : (dark ? '#e5736b' : '#d64545');
    const deco = this.term.registerDecoration({ marker, x: 0, width: 1, height: 1, backgroundColor: color, layer: 'top' });
    deco?.onRender((el) => {
      el.style.width = '3px';
      el.style.opacity = '0.8';
    });
  }

  classicLast(): { command: string; output: string } | undefined {
    const b = this.lastClassicBlock?.block;
    return b ? { command: b.command, output: this.lastOutputText } : undefined;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.resizeTimer);
    clearTimeout(this.idleTimer);
    clearTimeout(this.redrawTimer);
    clearTimeout(this.promptTimer);
    clearTimeout(this.scrollHintTimer);
    if (this.scrollDrag) clearInterval(this.scrollDrag.timer);
    this.observer.disconnect();
    this.unsubData();
    this.tracker.dispose();
    this.webgl?.dispose();
    this.term.dispose();
    this.element.remove();
  }
}

const hosts = new Map<string, TerminalHost>();

export function getHost(info: SessionInfo): TerminalHost {
  let h = hosts.get(info.id);
  if (!h) {
    h = new TerminalHost(info);
    hosts.set(info.id, h);
  } else {
    h.update(info);
  }
  return h;
}

export const peekHost = (id: string): TerminalHost | undefined => hosts.get(id);

export function disposeHost(id: string): void {
  hosts.get(id)?.dispose();
  hosts.delete(id);
}

export function allHosts(): IterableIterator<TerminalHost> {
  return hosts.values();
}

/** Read-only text of a terminal, used by the end-to-end tests (enabled only when ARCTRI_E2E is set). */
export function screenText(id: string): string {
  const h = hosts.get(id);
  if (!h) return '';
  const b = h.term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
  return lines.join('\n');
}

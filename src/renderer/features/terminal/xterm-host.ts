import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import type { CommandBlock } from '@shared/types/block';
import { AGENT_META } from '@shared/agents/meta';
import type { SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { clipboardImageThumb, copyText, readClipboard } from '@/lib/clipboard';
import { tNow } from '@/lib/i18n';
import { commandForKey } from '../../commands/registry';
import { useAgentStatus } from '@/stores/agent-status';
import { useAttachments } from '@/stores/attachments';
import { useBlocks } from '@/stores/blocks';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { isMac, isWindows, modKey } from '@/lib/platform';
import { planRemoval, type RemovalPlan, type RowCell } from '../agents/attachment-remove';
import { inputRegion, numberOf, placeholdersIn, reconcile, type TrackedAttachment } from '../agents/attachment-tracker';
import { insertAttachments } from '../agents/insert';
import { refreshChanges } from '../agents/useChanges';
import { BlockTracker } from './block-tracker';
import { ThaiInputTracker } from './thai-input';
import { TERMINAL_FONT, TERMINAL_LETTER_SPACING, terminalFontsReady, terminalTheme } from './theme';

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
  const k = e.key.toLowerCase();
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
      fontFamily: TERMINAL_FONT,
      fontSize: ui.prefs.fontSize,
      letterSpacing: TERMINAL_LETTER_SPACING,
      scrollback: ui.prefs.scrollback,
      cursorBlink: true,
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
    this.term.onResize(({ cols, rows }) => void api.sessions.resize(info.id, cols, rows));
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
    if (this.element.parentElement !== parent) parent.appendChild(this.element);
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
    } catch {
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
    this.info = info;
    this.tracker.update({ env: info.env, shell: info.shell });
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
    if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const agent = this.info.kind === 'agent' || !!this.info.runningAgent;
      const rest = agent ? this.thaiInput.backspace() : this.thaiBackspace();
      if (rest !== undefined) {
        api.sessions.write(this.info.id, '\x7f' + rest);
        return false;
      }
    }
    const k = e.key.toLowerCase();
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

  /** Where the caret stands relative to `needle` in the message box right now (see `planRemoval`); undefined when that is unclear. */
  private locate(needle: string): RemovalPlan | undefined {
    const info = useSessions.getState().infos[this.info.id] ?? this.info;
    const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
    const input = agentId ? AGENT_META[agentId]?.input : undefined;
    if (!input) return undefined;
    const lines = this.screenLines();
    const region = inputRegion(lines, input.prompt);
    if (region === undefined) return undefined;
    const buf = this.term.buffer.active;
    for (let y = lines.length - region.split('\n').length; y < lines.length; y++) {
      if (lines[y]!.includes(needle)) return planRemoval(this.rowCells(y), needle, y === buf.cursorY ? buf.cursorX : undefined);
    }
    return undefined;
  }

  private async until(cond: () => boolean, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 30));
    return cond();
  }

  /**
   * Takes an attachment out of the agent's message box. The caret is moved one key at a time and looked at after each key, and
   * Backspace is pressed only once the caret is seen right behind the text. If anything is unclear (the caret does not move,
   * the text is on another row, the screen does not answer) nothing is deleted and false is returned; the chip is dropped anyway.
   */
  async removeAttachment(att: TrackedAttachment): Promise<boolean> {
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
      let plan = this.locate(needle);
      traceAttach('start', needle, plan, 'cursor', this.term.buffer.active.cursorX, this.term.buffer.active.cursorY, 'rows', this.messageRows());
      if (!plan) continue;
      for (let i = 0; i < 40 && plan.moves !== 0; i++) {
        const before = plan.moves;
        write(before > 0 ? '\x1b[C' : '\x1b[D');
        // an agent may jump over a whole placeholder with one key: only the screen tells where the caret is
        await this.until(() => this.locate(needle)?.moves !== before, 400);
        plan = this.locate(needle);
        if (!plan || plan.moves === before) return false;
      }
      if (plan.moves !== 0) return false;
      if (needle !== att.token) {
        write('\x7f'.repeat(plan.width));
        return true;
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
        (thumb) => {
          if (!thumb) return;
          this.thumbTries.set(token, { tries: 17, at: Date.now(), done: true });
          const cur = useAttachments.getState().bySession[this.info.id] ?? [];
          useAttachments.getState().set(this.info.id, cur.map((x) => (x.token === token ? { ...x, thumb } : x)));
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
      this.fit.fit();
    } catch {
      /* not laid out yet */
    }
  }

  focus(): void {
    this.term.focus();
  }

  applyPrefs(fontSize: number, dark: boolean): void {
    if (this.term.options.fontSize !== fontSize) this.term.options.fontSize = fontSize;
    this.term.options.theme = terminalTheme(dark);
    this.scheduleFit(0);
  }

  /** Classic presentation: draw a coloured strip beside each finished command. */
  private decorate(b: CommandBlock): void {
    if (this.info.presentation !== 'classic') return;
    const marker = this.term.registerMarker(-1);
    if (!marker) return;
    const color = b.status === 'success' ? '#3fa24c' : b.status === 'unknown' ? '#6b7080' : '#e0554c';
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
    clearTimeout(this.promptTimer);
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

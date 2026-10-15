import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import type { CommandBlock } from '@shared/types/block';
import type { SessionInfo } from '@shared/types/session';
import { api } from '@/lib/api';
import { copyText, readClipboard } from '@/lib/clipboard';
import { tNow } from '@/lib/i18n';
import { commandForKey } from '../../commands/registry';
import { useAgentStatus } from '@/stores/agent-status';
import { useBlocks } from '@/stores/blocks';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { isMac, isWindows, modKey } from '@/lib/platform';
import { refreshChanges } from '../agents/useChanges';
import { BlockTracker } from './block-tracker';
import { TERMINAL_FONT, terminalTheme } from './theme';

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
    });

    this.term.attachCustomKeyEventHandler((e) => this.onKey(e));
    this.term.onData((d) => api.sessions.write(info.id, d));
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
    }
    this.scheduleFit(0);
  }

  private enableWebgl(): void {
    if (this.webgl || this.disposed) return;
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => {
        gl.dispose();
        if (this.webgl === gl) this.webgl = undefined;
      });
      this.term.loadAddon(gl);
      this.webgl = gl;
    } catch {
      this.webgl = undefined; // falls back to the DOM renderer
    }
  }

  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Browsers allow only a handful of WebGL contexts, so tabs left in the background give theirs up. */
  setActive(active: boolean): void {
    clearTimeout(this.idleTimer);
    if (active) {
      this.enableWebgl();
      this.scheduleFit(0);
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

  private onKey(e: KeyboardEvent): boolean {
    if (isAppChord(e)) return false;
    if (e.type !== 'keydown') return true;
    const k = e.key.toLowerCase();
    if (isMac) {
      // Cmd+C copies the selection and Cmd+V pastes; Ctrl+C is always the shell's interrupt
      if (e.metaKey && k === 'c') {
        this.copySelection();
        return false;
      }
      if (e.metaKey && k === 'v') {
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

  async pasteFromClipboard(): Promise<void> {
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

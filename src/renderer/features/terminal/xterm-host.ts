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
import { useBlocks } from '@/stores/blocks';
import { useSessions } from '@/stores/sessions';
import { useUi } from '@/stores/ui';
import { BlockTracker } from './block-tracker';
import { TERMINAL_FONT, terminalTheme } from './theme';

/** Key chords handled by the app; xterm must not forward them to the shell. */
function isAppChord(e: KeyboardEvent, agentActive: boolean): boolean {
  if (e.type !== 'keydown') return false;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && e.shiftKey && k === 'e') return true; // file panel
  if (e.ctrlKey && !e.shiftKey && !e.altKey && k === 'g' && agentActive) return true; // Rich Input
  if (e.ctrlKey && e.shiftKey && ['t', 'w', 'n', ','].includes(k)) return true;
  if (e.ctrlKey && k === 'tab') return true;
  if (e.ctrlKey && !e.shiftKey && (k === 'arrowup' || k === 'arrowdown')) return true;
  if (k === 'f2') return true;
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
      windowsPty: { backend: 'conpty', buildNumber: ui.windowsBuild },
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
          this.lastClassicBlock = { block: b, text: '' };
          this.lastOutputText = b.output ? b.output.lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n') : '';
          this.decorate(b);
        },
        onPhase: (p) => useSessions.getState().setUiPhase(info.id, p)
      }
    );

    this.term.attachCustomKeyEventHandler((e) => this.onKey(e));
    this.term.onData((d) => api.sessions.write(info.id, d));
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

  private lastSignalAt = 0;

  /** A bell or notification from the program. Only agents are allowed to ask for attention, and only when nobody is looking. */
  private agentSignal(title: string, body: string): void {
    const info = this.info;
    if (info.kind !== 'agent' && !info.runningAgent) return;
    const agentId = info.kind === 'agent' ? info.agentId : info.runningAgent?.agentId;
    const watching = useSessions.getState().activeId === info.id && document.hasFocus();
    if (watching) return;
    const now = Date.now();
    if (now - this.lastSignalAt < 10_000) return;
    this.lastSignalAt = now;
    if (useSessions.getState().activeId !== info.id) useSessions.getState().setAttention(info.id, true);
    if (useUi.getState().prefs.agentNotifications) {
      const name = agentId === 'claude-code' ? 'Claude Code' : agentId === 'codex' ? 'Codex' : info.title;
      void api.app.notify(info.id, title || name, body || tNow('agent.needsAttention'));
    }
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
    if (isAppChord(e, this.info.kind === 'agent' || !!this.info.runningAgent)) return false;
    if (e.type !== 'keydown') return true;
    const k = e.key.toLowerCase();
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

/** Read-only text of a terminal, used by the end-to-end tests (enabled only when AGENTDOCK_E2E is set). */
export function screenText(id: string): string {
  const h = hosts.get(id);
  if (!h) return '';
  const b = h.term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
  return lines.join('\n');
}

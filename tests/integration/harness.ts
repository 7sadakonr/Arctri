import { Terminal } from '@xterm/headless';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { SessionInfo } from '@shared/types/session';
import type { ShellProfile } from '@shared/types/env';
import type { CommandBlock } from '@shared/types/block';
import { BlockTracker } from '../../src/renderer/features/terminal/block-tracker';
import { NodePtyBackend } from '../../src/main/pty/pty-backend';
import { SessionManager, type FinishedCommand } from '../../src/main/pty/session-manager';
import { discoverWindowsProfiles, discoverWslProfiles } from '../../src/main/shell/discovery';
import { WslManager, wslExePath } from '../../src/main/wsl/wsl-manager';

export const wsl = new WslManager();

export async function allProfiles(): Promise<ShellProfile[]> {
  return [...discoverWindowsProfiles(), ...(await discoverWslProfiles(wsl, wslExePath()))];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | undefined | false, ms = 20000, what = 'condition'): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(25);
  }
}

export class Harness {
  info!: SessionInfo;
  commands: FinishedCommand[] = [];
  blocks: CommandBlock[] = [];
  tracker?: BlockTracker;
  raw = '';
  term = new Terminal({ cols: 120, rows: 30, scrollback: 10000, allowProposedApi: true, windowsPty: { backend: 'conpty', buildNumber: 19045 } });
  readonly manager: SessionManager;
  private profiles: ShellProfile[];

  constructor(profiles: ShellProfile[], opts: { cols?: number; rows?: number; conptyDll?: boolean; unicode11?: boolean } = {}) {
    this.profiles = profiles;
    this.manager = new SessionManager({
      backend: new NodePtyBackend(opts.conptyDll ?? true),
      getProfile: (id) => this.profiles.find((p) => p.id === id),
      toPosix: (d, p) => wsl.toPosix(d, p),
      onData: (id, chunk) => {
        this.raw += chunk;
        if (!this.tracker && this.info) {
          const i = this.info;
          this.tracker = new BlockTracker(
            this.term,
            { sessionId: i.id, nonce: i.nonce, env: i.env, shell: i.shell },
            { onBlockStarted: () => {}, onBlockFinished: (b) => this.blocks.push(b) }
          );
        }
        this.term.write(chunk);
        this.manager.ack(id, chunk.length);
      },
      onInfo: (i) => (this.info = i),
      onCommand: (c) => this.commands.push(c)
    });
    if (opts.cols) this.term.resize(opts.cols, opts.rows ?? 30);
    if (opts.unicode11) {
      this.term.loadAddon(new Unicode11Addon());
      this.term.unicode.activeVersion = '11';
    }
  }

  async start(profileId: string, presentation: 'blocks' | 'classic' = 'blocks') {
    await this.manager.create({ profileId, kind: 'shell', cols: this.term.cols, rows: this.term.rows, presentation });
    await waitFor(() => this.info?.integration === 'active' && this.info.phase === 'editing', 30000, 'first prompt');
  }

  async run(command: string, timeout = 30000): Promise<FinishedCommand> {
    const before = this.commands.length;
    const res = this.manager.submitCommand(this.info.id, command);
    if (!res.ok) throw new Error('submit failed: ' + res.reason);
    return waitFor(() => this.commands.length > before && this.info.phase === 'editing' && this.commands[before], timeout, `command ${command}`);
  }

  screenText(): string {
    const b = this.term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
    return lines.join('\n');
  }

  async stop() {
    this.tracker?.dispose();
    if (this.info) await this.manager.close(this.info.id);
    this.term.dispose();
  }
}

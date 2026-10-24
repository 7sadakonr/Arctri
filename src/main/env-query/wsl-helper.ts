import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { integrationDir } from '../paths';
import { wslExePath } from '../wsl/wsl-manager';

export type WslOp =
  | 'ls' | 'lsd' | 'cmds' | 'branches' | 'cat' | 'branch' | 'home' | 'ping' | 'gitstat' | 'codexcfg' | 'codexcfgw'
  | 'gitall' | 'headtext' | 'statfile' | 'readfile' | 'writefile' | 'refs' | 'gitlog' | 'gitshow'
  | 'mkfile' | 'mkdir' | 'mv' | 'rm' | 'cp';

type Proc = ChildProcessByStdio<Writable, Readable, null>;

// An empty field would be collapsed by `read` (TAB is whitespace in IFS) and shift the later fields left;
// '=' is not valid base64, so the helper's `base64 -d` turns it back into an empty string.
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64') || '=';

/**
 * One long-lived `sh` per distribution. It is started on first use, restarted if it dies (at most
 * three times a minute) and stopped after five idle minutes. Requests carry only fixed operation
 * names and base64 data, so nothing a user types is ever executed.
 */
export class WslHelperClient {
  private proc: Proc | undefined;
  private seq = 0;
  private pending = new Map<string, { resolve: (v: string | null) => void; timer: ReturnType<typeof setTimeout> }>();
  private buf = '';
  private idle: ReturnType<typeof setTimeout> | undefined;
  private starts: number[] = [];
  private disposed = false;

  constructor(readonly distro: string, private readonly login = true) {}

  private start(): Proc | undefined {
    if (this.proc) return this.proc;
    const now = Date.now();
    this.starts = this.starts.filter((t) => now - t < 60_000);
    if (this.starts.length >= 3 || this.disposed) return undefined;
    this.starts.push(now);
    const script = readFileSync(join(integrationDir(), 'wsl-helper.sh'), 'utf8');
    const p = spawn(
      wslExePath(),
      ['-d', this.distro, '--exec', 'bash', this.login ? '-lc' : '-c', 'eval "$(printf %s "$0" | base64 -d)"', b64(script)],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
    );
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => this.onData(d));
    const gone = () => {
      if (this.proc === p) this.proc = undefined;
      for (const [id, w] of this.pending) {
        clearTimeout(w.timer);
        w.resolve(null);
        this.pending.delete(id);
      }
    };
    p.on('exit', gone);
    p.on('error', gone);
    p.stdin.on('error', () => undefined);
    this.proc = p;
    return p;
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const w = this.pending.get(line.slice(0, tab));
      if (!w) continue;
      clearTimeout(w.timer);
      this.pending.delete(line.slice(0, tab));
      w.resolve(Buffer.from(line.slice(tab + 1), 'base64').toString('utf8'));
    }
  }

  /** Resolves with the decoded output, or null on timeout or when the helper is unavailable. */
  request(op: WslOp, args: string[] = [], timeoutMs = 1500): Promise<string | null> {
    const p = this.start();
    if (!p) return Promise.resolve(null);
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.dispose(false), 5 * 60_000);
    const id = String(++this.seq);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      const line = [id, op, b64(args[0] ?? ''), b64(args[1] ?? ''), b64(args[2] ?? '')].join('\t') + '\n';
      try {
        p.stdin.write(line);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(null);
      }
    });
  }

  dispose(final = true): void {
    if (final) this.disposed = true;
    clearTimeout(this.idle);
    const p = this.proc;
    this.proc = undefined;
    try {
      p?.stdin.end();
      p?.kill();
    } catch {
      /* already gone */
    }
  }
}

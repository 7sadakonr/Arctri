import * as nodePtyNs from 'node-pty';

// node-pty is CommonJS; under ESM the functions live on `default` in some loaders and on the namespace in others.
const nodePty: typeof import('node-pty') = (nodePtyNs as unknown as { default?: typeof import('node-pty') }).default ?? nodePtyNs;

export interface PtyProcess {
  /** 0 until the process exists (see onSpawn). */
  readonly pid: number;
  onSpawn(cb: (pid: number) => void): void;
  onError(cb: (message: string) => void): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): void;
}

export interface PtySpawnOptions {
  file: string;
  /** A string is a raw Windows command line (used for cmd.exe /c shims). */
  args: string[] | string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  /** Default is chosen by the backend (bundled conpty.dll). */
  useConptyDll?: boolean;
}

export interface PtyBackend {
  spawn(o: PtySpawnOptions): PtyProcess;
}

/** Starts a node-pty process and wires it to the callbacks of the worker or the in-process wrapper. */
export function startNodePty(o: PtySpawnOptions & { useConptyDll: boolean }) {
  return nodePty.spawn(o.file, o.args, {
    name: 'xterm-256color',
    cols: o.cols,
    rows: o.rows,
    cwd: o.cwd,
    env: o.env,
    useConpty: true,
    useConptyDll: o.useConptyDll
  } as import('node-pty').IWindowsPtyForkOptions);
}

/**
 * node-pty over ConPTY, in the calling thread. `spawn()` can block for seconds on some machines (PowerShell 7 is
 * slow to create under Electron here), so the application uses WorkerPtyBackend instead; this one serves tests
 * and tools that have no worker file.
 */
export class NodePtyBackend implements PtyBackend {
  constructor(private readonly useConptyDll = true) {}

  spawn(o: PtySpawnOptions): PtyProcess {
    const spawnCbs: Array<(pid: number) => void> = [];
    const errorCbs: Array<(m: string) => void> = [];
    let p: ReturnType<typeof startNodePty> | undefined;
    let error: string | undefined;
    try {
      p = startNodePty({ ...o, useConptyDll: o.useConptyDll ?? this.useConptyDll });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    queueMicrotask(() => {
      if (p) spawnCbs.forEach((cb) => cb(p!.pid));
      else errorCbs.forEach((cb) => cb(error!));
    });
    return {
      get pid() {
        return p?.pid ?? 0;
      },
      onSpawn: (cb) => void spawnCbs.push(cb),
      onError: (cb) => void errorCbs.push(cb),
      onData: (cb) => void p?.onData(cb),
      onExit: (cb) => void p?.onExit(cb),
      write: (d) => p?.write(d),
      resize: (c, r) => {
        try {
          p?.resize(Math.max(2, c), Math.max(1, r));
        } catch {
          /* process already gone */
        }
      },
      pause: () => p?.pause(),
      resume: () => p?.resume(),
      kill: () => {
        try {
          p?.kill();
        } catch {
          /* already gone */
        }
      }
    };
  }
}

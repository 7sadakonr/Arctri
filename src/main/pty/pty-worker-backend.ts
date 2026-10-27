import { Worker } from 'node:worker_threads';
import type { PtyBackend, PtyProcess, PtySpawnOptions } from './pty-backend';

type Out =
  | { t: 'spawned'; pid: number }
  | { t: 'data'; data: string }
  | { t: 'exit'; exitCode: number; signal?: number }
  | { t: 'error'; message: string };

/**
 * One worker thread per terminal session. The default is the bundled conpty.dll: the ConPTY inside Windows 10
 * reorders OSC sequences, loses Thai vowels in Windows PowerShell and is 6 to 10 times slower (ADR-001, 003, 007).
 */
export class WorkerPtyBackend implements PtyBackend {
  constructor(
    private readonly workerFile: string | URL,
    private readonly useConptyDll = true
  ) {}

  spawn(o: PtySpawnOptions): PtyProcess {
    const worker = new Worker(this.workerFile);
    let pid = 0;
    let done = false;
    const cb = {
      spawn: [] as Array<(pid: number) => void>,
      error: [] as Array<(m: string) => void>,
      data: [] as Array<(d: string) => void>,
      exit: [] as Array<(e: { exitCode: number; signal?: number }) => void>
    };
    worker.on('message', (m: Out) => {
      switch (m.t) {
        case 'spawned':
          pid = m.pid;
          cb.spawn.forEach((f) => f(pid));
          break;
        case 'data':
          cb.data.forEach((f) => f(m.data));
          break;
        case 'exit':
          if (!done) {
            done = true;
            cb.exit.forEach((f) => f({ exitCode: m.exitCode, ...(m.signal !== undefined ? { signal: m.signal } : {}) }));
            void worker.terminate();
          }
          break;
        case 'error':
          done = true;
          cb.error.forEach((f) => f(m.message));
          void worker.terminate();
          break;
      }
    });
    worker.on('error', (e) => {
      if (!done) cb.error.forEach((f) => f(e.message));
      done = true;
    });
    // The worker is gone without having reported an exit (a native crash in the PTY library, for example). That is a
    // failure of the session, not an exit code of the shell: the worker's own code must not pass for the shell's.
    worker.on('exit', (code) => {
      if (done) return;
      done = true;
      cb.error.forEach((f) => f(`PTY worker stopped unexpectedly (code ${code})`));
    });

    worker.postMessage({ t: 'spawn', opts: { ...o, useConptyDll: o.useConptyDll ?? this.useConptyDll } });
    const send = (m: object) => {
      if (!done) worker.postMessage(m);
    };
    return {
      get pid() {
        return pid;
      },
      onSpawn: (f) => void cb.spawn.push(f),
      onError: (f) => void cb.error.push(f),
      onData: (f) => void cb.data.push(f),
      onExit: (f) => void cb.exit.push(f),
      write: (data) => send({ t: 'write', data }),
      resize: (cols, rows) => send({ t: 'resize', cols, rows }),
      pause: () => send({ t: 'pause' }),
      resume: () => send({ t: 'resume' }),
      kill: () => send({ t: 'kill' })
    };
  }
}

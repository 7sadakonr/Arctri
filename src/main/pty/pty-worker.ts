// Runs in a worker thread: owns one PTY. Everything that can block (CreateProcess for a slow program) happens
// here, so the Electron main process, and with it the window, never stalls.
import { parentPort } from 'node:worker_threads';
import { startNodePty, type PtySpawnOptions } from './pty-backend';

type In =
  | { t: 'spawn'; opts: PtySpawnOptions & { useConptyDll: boolean } }
  | { t: 'write'; data: string }
  | { t: 'resize'; cols: number; rows: number }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'kill' };

const port = parentPort!;
let pty: ReturnType<typeof startNodePty> | undefined;

port.on('message', (m: In) => {
  try {
    switch (m.t) {
      case 'spawn':
        pty = startNodePty(m.opts); // blocks this thread only
        port.postMessage({ t: 'spawned', pid: pty.pid });
        pty.onData((data) => port.postMessage({ t: 'data', data }));
        pty.onExit((e) => port.postMessage({ t: 'exit', exitCode: e.exitCode, signal: e.signal }));
        break;
      case 'write':
        pty?.write(m.data);
        break;
      case 'resize':
        pty?.resize(Math.max(2, m.cols), Math.max(1, m.rows));
        break;
      case 'pause':
        pty?.pause();
        break;
      case 'resume':
        pty?.resume();
        break;
      case 'kill':
        // Messages are handled in order, so a kill sent while the spawn was still blocking arrives here after it.
        pty?.kill();
        break;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A failed spawn ends the tab; anything later (the process may just be exiting) is only worth a log line.
    port.postMessage(m.t === 'spawn' ? { t: 'error', message } : { t: 'warn', message: `${m.t}: ${message}` });
  }
});

// A stand-in for pty-worker.js whose behaviour is chosen by the `file` of the spawn options.
import { parentPort } from 'node:worker_threads';

parentPort.on('message', (m) => {
  if (m.t !== 'spawn') return;
  switch (m.opts.file) {
    case 'crash':
      parentPort.postMessage({ t: 'spawned', pid: 99 });
      setTimeout(() => process.exit(3), 5);
      break;
    case 'throw-before-spawn':
      setTimeout(() => {
        throw new Error('native crash');
      }, 5);
      break;
    case 'clean-exit':
      parentPort.postMessage({ t: 'spawned', pid: 99 });
      parentPort.postMessage({ t: 'exit', exitCode: 0 });
      break;
    case 'warn':
      parentPort.postMessage({ t: 'spawned', pid: 99 });
      parentPort.postMessage({ t: 'warn', message: 'resize failed' });
      break;
  }
});

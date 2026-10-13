import { describe, expect, it } from 'vitest';
import { WorkerPtyBackend } from './pty-worker-backend';

const fixture = new URL('./__fixtures__/scripted-worker.mjs', import.meta.url);

function run(file: string, log?: (m: string, x?: unknown) => void) {
  const backend = new WorkerPtyBackend(fixture, false, log);
  const pty = backend.spawn({ file, args: [], cwd: '.', env: {}, cols: 80, rows: 24 });
  const events: string[] = [];
  pty.onSpawn((pid) => events.push(`spawn:${pid}`));
  pty.onError((m) => events.push(`error:${m}`));
  pty.onExit((e) => events.push(`exit:${e.exitCode}`));
  const settled = (until: (e: string[]) => boolean) =>
    new Promise<string[]>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out, saw ${JSON.stringify(events)}`)), 5000);
      const poll = setInterval(() => {
        if (until(events)) {
          clearTimeout(t);
          clearInterval(poll);
          resolve(events);
        }
      }, 5);
    });
  return { pty, events, settled };
}

describe('WorkerPtyBackend', () => {
  it('reports a worker that dies on its own as an error, not as a shell exit', async () => {
    const { settled } = run('crash');
    const ev = await settled((e) => e.some((x) => x.startsWith('error') || x.startsWith('exit')));
    expect(ev).toEqual(['spawn:99', expect.stringMatching(/^error:PTY worker exited unexpectedly \(code 3\)$/)]);
  });

  it('reports an uncaught exception in the worker once, as an error', async () => {
    const { settled } = run('throw-before-spawn');
    const ev = await settled((e) => e.some((x) => x.startsWith('error')));
    await new Promise((r) => setTimeout(r, 50)); // the worker's exit event must not add a second report
    expect(ev.filter((x) => x.startsWith('error'))).toHaveLength(1);
    expect(ev.some((x) => x.startsWith('exit'))).toBe(false);
  });

  it('reports a normal exit once, as an exit', async () => {
    const { settled } = run('clean-exit');
    const ev = await settled((e) => e.some((x) => x.startsWith('exit')));
    await new Promise((r) => setTimeout(r, 50));
    expect(ev).toEqual(['spawn:99', 'exit:0']);
  });

  it('passes worker warnings to the log and leaves the session alone', async () => {
    const logs: string[] = [];
    const { settled, events } = run('warn', (m) => logs.push(m));
    await settled(() => logs.length > 0);
    expect(logs[0]).toContain('resize failed');
    expect(events).toEqual(['spawn:99']);
  });
});

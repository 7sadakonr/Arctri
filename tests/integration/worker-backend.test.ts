import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkerPtyBackend } from '../../src/main/pty/pty-worker-backend';
import { waitFor } from './harness';

// The worker is the built file; run `npm run build` first.
const workerFile = join(process.cwd(), 'out', 'main', 'pty-worker.js');
const sys = (process.env['SystemRoot'] ?? 'C:\\Windows') + '\\System32\\';
const base = { cwd: process.env['USERPROFILE'] ?? 'C:\\', env: process.env as Record<string, string>, cols: 80, rows: 24 };

describe.skipIf(!existsSync(workerFile))('WorkerPtyBackend (built worker thread)', () => {
  const backend = new WorkerPtyBackend(workerFile, true);

  it('spawns, streams output and reports the exit code', async () => {
    const p = backend.spawn({ ...base, file: sys + 'cmd.exe', args: ['/c', 'echo worker-works & exit 7'] });
    let out = '';
    let spawnedPid = 0;
    let exit: number | undefined;
    p.onSpawn((pid) => (spawnedPid = pid));
    p.onData((d) => (out += d));
    p.onExit((e) => (exit = e.exitCode));
    expect(p.pid).toBe(0); // returns at once, before the process exists
    await waitFor(() => exit !== undefined, 15000, 'exit');
    expect(spawnedPid).toBeGreaterThan(0);
    expect(out).toContain('worker-works');
    expect(exit).toBe(7);
  });

  it('accepts input, resize and kill, and applies a kill that arrives before the spawn finished', async () => {
    const a = backend.spawn({ ...base, file: sys + 'cmd.exe', args: [] });
    let out = '';
    let aExit: number | undefined;
    a.onData((d) => (out += d));
    a.onExit((e) => (aExit = e.exitCode));
    a.write('echo typed-input\r');
    a.resize(120, 40);
    await waitFor(() => out.includes('typed-input'), 15000, 'echo');
    a.kill();
    await waitFor(() => aExit !== undefined, 15000, 'killed');

    const b = backend.spawn({ ...base, file: sys + 'cmd.exe', args: [] });
    let bExit: number | undefined;
    b.onExit((e) => (bExit = e.exitCode));
    b.kill(); // immediately, while the process is still being created
    await waitFor(() => bExit !== undefined, 20000, 'early kill');
  });

  it('reports a program that cannot be started as an error, not a crash', async () => {
    const p = backend.spawn({ ...base, file: 'C:\\no\\such\\program.exe', args: [] });
    let error: string | undefined;
    p.onError((m) => (error = m));
    await waitFor(() => error !== undefined, 15000, 'error');
    expect(error).toBeTruthy();
  });

  it('keeps independent sessions independent', async () => {
    const outs = ['', '', ''];
    const exits: Array<number | undefined> = [undefined, undefined, undefined];
    ['one', 'two', 'three'].forEach((word, i) => {
      const p = backend.spawn({ ...base, file: sys + 'cmd.exe', args: ['/c', `echo ${word}`] });
      p.onData((d) => (outs[i] += d));
      p.onExit((e) => (exits[i] = e.exitCode));
    });
    await waitFor(() => exits.every((e) => e !== undefined), 20000, 'all exit');
    expect(outs[0]).toContain('one');
    expect(outs[1]).toContain('two');
    expect(outs[2]).toContain('three');
  });
});

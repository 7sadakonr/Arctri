import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellProfile } from '@shared/types/env';
import type { SessionInfo } from '@shared/types/session';
import type { PtyBackend, PtyProcess } from './pty-backend';

const cleanup = vi.hoisted(() => ({
  snapshotTrees: vi.fn(async (roots: number[]) => new Map(roots.map((r) => [r, [{ pid: r + 1 }]]))),
  killTree: vi.fn(async (_pid: number) => {}),
  killRecorded: vi.fn(async (_p: unknown[]) => {})
}));
vi.mock('./process-cleanup', () => cleanup);

import { SessionManager } from './session-manager';

/** A PTY whose spawn, error and exit the test triggers by hand, like a worker that is slow or dies. */
class ManualPty implements PtyProcess {
  pid = 0;
  killed = 0;
  paused = false;
  autoExitOnKill = true;
  private cb = { spawn: [] as Array<(p: number) => void>, error: [] as Array<(m: string) => void>, data: [] as Array<(d: string) => void>, exit: [] as Array<(e: { exitCode: number }) => void> };
  onSpawn(f: (pid: number) => void) { this.cb.spawn.push(f); }
  onError(f: (m: string) => void) { this.cb.error.push(f); }
  onData(f: (d: string) => void) { this.cb.data.push(f); }
  onExit(f: (e: { exitCode: number }) => void) { this.cb.exit.push(f); }
  write() {}
  resize() {}
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  kill() {
    this.killed++;
    if (this.autoExitOnKill && this.pid) queueMicrotask(() => this.emitExit(0));
  }
  emitSpawn(pid: number) { this.pid = pid; this.cb.spawn.forEach((f) => f(pid)); }
  emitError(m: string) { this.cb.error.forEach((f) => f(m)); }
  emitData(d: string) { this.cb.data.forEach((f) => f(d)); }
  emitExit(code: number) { this.cb.exit.forEach((f) => f({ exitCode: code })); }
}

const profile: ShellProfile = {
  id: 'win:cmd', label: 'cmd', env: { kind: 'windows' }, shell: 'cmd', executable: 'C:\\Windows\\System32\\cmd.exe', integration: 'none'
} as ShellProfile;
const spec = { profileId: profile.id, kind: 'shell' as const, cols: 80, rows: 24 };

function setup(extra: { spawnWaitMs?: number } = {}) {
  const pty = new ManualPty();
  const infos: SessionInfo[] = [];
  const closed: string[] = [];
  const logs: string[] = [];
  const m = new SessionManager({
    backend: { spawn: () => pty } as PtyBackend,
    getProfile: (id) => (id === profile.id ? profile : undefined),
    toPosix: async () => null,
    onData: () => {},
    onInfo: (i) => infos.push(i),
    onClosed: (id) => closed.push(id),
    log: (msg) => logs.push(msg),
    ...extra
  });
  return { m, pty, infos, closed, logs, states: () => infos.map((i) => i.state) };
}

beforeEach(() => vi.clearAllMocks());

describe('SessionManager close during spawn', () => {
  it('kills as soon as the spawn finishes and never reports the dead tab as running', async () => {
    const { m, pty, states, closed } = setup();
    const info = await m.create(spec);
    const closing = m.close(info.id);
    await Promise.resolve();
    expect(pty.killed).toBe(1); // queued behind the spawn right away
    pty.emitSpawn(777);
    pty.emitExit(0);
    await closing;
    expect(states()).not.toContain('running');
    expect(closed).toEqual([info.id]);
    expect(cleanup.snapshotTrees).toHaveBeenCalledWith([777]);
    expect(cleanup.killRecorded).toHaveBeenCalled();
  });

  it('gives up after spawnWaitMs, drops the session, and reaps the process when it finally appears', async () => {
    vi.useFakeTimers();
    try {
      const { m, pty, states, closed, logs } = setup({ spawnWaitMs: 5000 });
      const info = await m.create(spec);
      const closing = m.close(info.id);
      await vi.advanceTimersByTimeAsync(5001);
      await closing;
      expect(closed).toEqual([info.id]);
      expect(m.get(info.id)).toBeUndefined();
      expect(logs.join()).toMatch(/spawn/i);
      pty.emitSpawn(888); // the worker was only slow
      expect(cleanup.killTree).toHaveBeenCalledWith(888);
      expect(states()).not.toContain('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait for a spawn that already failed', async () => {
    const { m, pty, closed } = setup();
    const info = await m.create(spec);
    pty.emitError('boom');
    await m.close(info.id);
    expect(closed).toEqual([info.id]);
  });
});

describe('SessionManager close', () => {
  it('is idempotent: two calls share one kill sequence and one onClosed', async () => {
    const { m, pty, closed } = setup();
    const info = await m.create(spec);
    pty.emitSpawn(10);
    const a = m.close(info.id);
    const b = m.close(info.id);
    await Promise.all([a, b]);
    expect(closed).toEqual([info.id]);
    expect(pty.killed).toBe(1);
  });
});

describe('SessionManager worker failure', () => {
  it('marks the tab failed and kills what the dead worker left behind', async () => {
    const { m, pty, infos } = setup();
    const info = await m.create(spec);
    pty.emitSpawn(321);
    pty.emitError('PTY worker exited unexpectedly (code 3)');
    expect(infos.at(-1)).toMatchObject({ state: 'failed', exit: { code: null, reason: expect.stringContaining('unexpectedly') } });
    expect(cleanup.killTree).toHaveBeenCalledWith(321);
    expect(m.stats().workerCrashes).toBe(1);
    expect(m.get(info.id)?.state).toBe('failed');
  });

  it('a spawn error before any process existed is not a crash and kills nothing', async () => {
    const { m, pty } = setup();
    await m.create(spec);
    pty.emitError('cannot find shell');
    expect(cleanup.killTree).not.toHaveBeenCalled();
    expect(m.stats().workerCrashes).toBe(0);
  });

  it('says nothing to the renderer about an error while the tab is being closed', async () => {
    const { m, pty, infos } = setup();
    const info = await m.create(spec);
    pty.emitSpawn(5);
    pty.autoExitOnKill = false;
    const closing = m.close(info.id);
    await Promise.resolve();
    await Promise.resolve();
    const before = infos.length;
    pty.emitError('late');
    await closing;
    expect(infos.length).toBe(before);
  });
});

describe('SessionManager flow control', () => {
  it('resetFlow resumes a PTY that was paused waiting for acknowledgements of a gone page', async () => {
    const { m, pty } = setup();
    const info = await m.create(spec);
    pty.emitSpawn(1);
    pty.emitData('x'.repeat(3 * 1024 * 1024));
    await new Promise((r) => setTimeout(r, 30));
    expect(pty.paused).toBe(true);
    m.resetFlow(info.id);
    expect(pty.paused).toBe(false);
  });

  it('counts an acknowledgement stall', async () => {
    vi.useFakeTimers();
    try {
      const { m, pty } = setup();
      await m.create(spec);
      pty.emitSpawn(1);
      pty.emitData('x'.repeat(3 * 1024 * 1024));
      await vi.advanceTimersByTimeAsync(11_000);
      expect(m.stats().flowStalls).toBe(1);
      expect(pty.paused).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

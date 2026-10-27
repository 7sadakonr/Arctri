import { describe, expect, it } from 'vitest';
import type { ShellProfile } from '@shared/types/env';
import type { SessionInfo } from '@shared/types/session';
import type { PtyBackend, PtyProcess } from './pty-backend';
import { SessionManager } from './session-manager';

class FakePty implements PtyProcess {
  static next = 1000;
  pid = FakePty.next++;
  written: string[] = [];
  writesAfterEnd = 0;
  ended = false;
  private spawnCb: Array<(pid: number) => void> = [];
  private err: Array<(m: string) => void> = [];
  private data: Array<(d: string) => void> = [];
  private exit: Array<(e: { exitCode: number }) => void> = [];
  onSpawn(cb: (pid: number) => void) { this.spawnCb.push(cb); queueMicrotask(() => cb(this.pid)); }
  onError(cb: (m: string) => void) { this.err.push(cb); }
  onData(cb: (d: string) => void) { this.data.push(cb); }
  onExit(cb: (e: { exitCode: number }) => void) { this.exit.push(cb); }
  write(d: string) { if (this.ended) this.writesAfterEnd++; this.written.push(d); }
  resize() {}
  pause() {}
  resume() {}
  kill() { queueMicrotask(() => this.end(0)); }
  emit(d: string) { if (!this.ended) this.data.forEach((f) => f(d)); }
  end(code: number) { this.ended = true; this.exit.forEach((f) => f({ exitCode: code })); }
  crash(m: string) { this.ended = true; this.err.forEach((f) => f(m)); }
}

const profile: ShellProfile = {
  id: 'pwsh', label: 'PowerShell', env: { kind: 'windows' }, shell: 'pwsh', executable: 'pwsh.exe', integration: 'blocks'
};

// a small deterministic generator, so a failure can be replayed
function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('session lifecycle under churn', () => {
  it('leaves nothing behind after many sessions end in every possible way', async () => {
    const ptys: FakePty[] = [];
    const infos = new Map<string, SessionInfo>();
    const killedTrees: number[] = [];
    const closed: string[] = [];
    const m = new SessionManager({
      backend: { spawn: () => { const p = new FakePty(); ptys.push(p); return p; } } as PtyBackend,
      getProfile: (id) => (id === profile.id ? profile : undefined),
      toPosix: async () => '/x',
      onData: () => undefined,
      onInfo: (i) => infos.set(i.id, i),
      onClosed: (id) => closed.push(id),
      killTree: async (pid) => void killedTrees.push(pid),
      killTreeSync: (pid) => void killedTrees.push(pid),
      snapshotTrees: async () => new Map(), // the real one asks PowerShell on Windows, seconds per call
      busyPollMs: 0
    });
    const rand = rng(42);
    const spec = { profileId: profile.id, kind: 'shell' as const, cols: 100, rows: 30 };
    const ids: string[] = [];

    for (let i = 0; i < 120; i++) {
      const { id } = await m.create(spec);
      ids.push(id);
      const pty = ptys.at(-1)!;
      await Promise.resolve();
      pty.emit('output ' + i);
      const r = rand();
      if (r < 0.2) pty.end(Math.floor(rand() * 3)); // the shell exits by itself
      else if (r < 0.4) pty.crash('worker died'); // the machinery fails
      else if (r < 0.7) await m.close(id); // the user closes the tab
      // else: left running, closed with everything at the end
      pty.emit('late output'); // after any of the above
      m.write(id, 'typed after the end'); // must be ignored for ended sessions, never throw
      m.resize(id, 80 + (i % 20), 24);
    }

    await m.closeAll(2000);
    expect(m.list()).toEqual([]);
    // every session was reported closed exactly once
    expect([...closed].sort()).toEqual([...ids].sort());
    // nothing is written to a process that already ended
    expect(ptys.filter((p) => p.writesAfterEnd > 0)).toEqual([]);
    // every failed session had its process tree ended
    const failed = [...infos.values()].filter((i) => i.state === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    for (const f of failed) expect(killedTrees).toContain(f.pid);
  }, 30_000);
});

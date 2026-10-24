import { describe, expect, it, vi } from 'vitest';
import { encodeB64 } from '@shared/osc/protocol';
import type { ShellProfile } from '@shared/types/env';
import type { SessionInfo } from '@shared/types/session';
import type { PtyBackend, PtyProcess, PtySpawnOptions } from './pty-backend';
import { SessionManager, type FinishedCommand } from './session-manager';

class FakePty implements PtyProcess {
  pid = 4242;
  written: string[] = [];
  killed = false;
  paused = false;
  private data: Array<(d: string) => void> = [];
  private exit: Array<(e: { exitCode: number }) => void> = [];
  onSpawn(cb: (pid: number) => void) { queueMicrotask(() => cb(this.pid)); }
  onError() {}
  onData(cb: (d: string) => void) { this.data.push(cb); }
  onExit(cb: (e: { exitCode: number }) => void) { this.exit.push(cb); }
  write(d: string) { this.written.push(d); }
  resize() {}
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  kill() { this.killed = true; queueMicrotask(() => this.emitExit(0)); }
  emit(d: string) { this.data.forEach((f) => f(d)); }
  emitExit(code: number) { this.exit.forEach((f) => f({ exitCode: code })); }
}

const profile: ShellProfile = {
  id: 'wsl:Ubuntu:bash', label: 'Ubuntu · bash', env: { kind: 'wsl', distro: 'Ubuntu' }, shell: 'bash',
  executable: 'C:\\wsl.exe', integration: 'blocks'
};

function setup(opts: { helloTimeoutMs?: number; profile?: ShellProfile } = {}) {
  const pty = new FakePty();
  const infos: SessionInfo[] = [];
  const out: string[] = [];
  const cmds: FinishedCommand[] = [];
  const spawns: PtySpawnOptions[] = [];
  const backend: PtyBackend = { spawn: (o) => (spawns.push(o), pty) };
  const p = opts.profile ?? profile;
  const m = new SessionManager({
    backend,
    getProfile: (id) => (id === p.id ? p : undefined),
    toPosix: async () => '/mnt/x',
    onData: (_id, c) => out.push(c),
    onInfo: (i) => infos.push(i),
    onCommand: (c) => cmds.push(c),
    ...(opts.helloTimeoutMs ? { helloTimeoutMs: opts.helloTimeoutMs } : {})
  });
  return { m, pty, infos, out, cmds, spawns, last: () => infos.at(-1)! };
}

const spec = { profileId: profile.id, kind: 'shell' as const, cols: 100, rows: 30 };
const osc = (nonce: string, b: string) => `\x1b]${b}\x07`;
const mark = (n: string, k: string, extra = '') => osc(n, `133;${k}${extra};aid=${n}`);
const hello = (n: string) => osc(n, `6973;${n};hello;bash;5.2;1`);
const cmd = (n: string, id: number, t: string) => osc(n, `6973;${n};cmd;${id};${encodeB64(t)}`);
const cwd = (n: string, p: string) => osc(n, `6973;${n};cwd;${encodeB64(p)}`);

describe('SessionManager', () => {
  it('spawns with the launch plan and exposes a per-session nonce', async () => {
    const { m, spawns } = setup();
    const info = await m.create(spec);
    expect(info.state).toBe('starting'); // becomes running once the PTY reports its pid
    await Promise.resolve();
    expect(m.get(info.id)).toMatchObject({ state: 'running', pid: 4242 });
    expect(info.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(spawns[0]!.cols).toBe(100);
    expect(spawns[0]!.env['ARCTRI_NONCE']).toBe(info.nonce);
    const second = await m.create(spec);
    expect(second.nonce).not.toBe(info.nonce);
  });

  it('follows the shell through hello, prompt, command, finish, and records history', async () => {
    const { m, pty, last, cmds } = setup();
    const { nonce: n } = await m.create(spec);
    pty.emit(hello(n) + cwd(n, '/home/me/proj') + mark(n, 'A') + mark(n, 'B'));
    expect(last()).toMatchObject({ integration: 'active', phase: 'editing', cwd: { env: 'wsl', distro: 'Ubuntu', path: '/home/me/proj' } });
    expect(last().title).toBe('Ubuntu · bash · proj');
    pty.emit(cmd(n, 1, 'ls ผู้ใช้') + mark(n, 'C'));
    expect(last().phase).toBe('executing');
    pty.emit('out\r\n' + mark(n, 'D', ';2') + mark(n, 'A') + mark(n, 'B'));
    expect(last().phase).toBe('editing');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ command: 'ls ผู้ใช้', exitCode: 2, profileId: profile.id });
    expect(cmds[0]!.cwd).toEqual({ env: 'wsl', distro: 'Ubuntu', path: '/home/me/proj' });
  });

  it('forwards the PTY bytes unchanged, even when a sequence is split across chunks', async () => {
    const { m, pty, out, last } = setup();
    const { nonce: n } = await m.create(spec);
    const stream = hello(n) + 'plain text สวัสดี\r\n' + mark(n, 'A') + mark(n, 'B');
    for (let i = 0; i < stream.length; i += 5) pty.emit(stream.slice(i, i + 5));
    await new Promise((r) => setTimeout(r, 30));
    expect(out.join('')).toBe(stream);
    expect(last().integration).toBe('active');
  });

  it('ignores forged integration sequences (wrong nonce)', async () => {
    const { m, pty, last, cmds } = setup();
    await m.create(spec);
    pty.emit(hello('evil') + cmd('evil', 1, 'rm -rf /') + mark('evil', 'C') + mark('evil', 'D', ';0'));
    expect(last().integration).toBe('pending');
    expect(last().phase).toBe('unknown');
    expect(cmds).toHaveLength(0);
  });

  it('only accepts a command at a prompt, and only with active integration', async () => {
    const { m, pty } = setup();
    const { id, nonce: n } = await m.create(spec);
    expect(m.submitCommand(id, 'ls')).toEqual({ ok: false, reason: 'no-integration' });
    pty.emit(hello(n) + mark(n, 'A') + mark(n, 'B'));
    expect(m.submitCommand(id, 'ls')).toEqual({ ok: true });
    expect(pty.written.join('')).toContain('ls\r');
    pty.emit(cmd(n, 1, 'ls') + mark(n, 'C'));
    expect(m.submitCommand(id, 'pwd')).toEqual({ ok: false, reason: 'not-at-prompt' });
  });

  it('marks integration unavailable when the shell never says hello, and degraded after repeated anomalies', async () => {
    const a = setup({ helloTimeoutMs: 20 });
    await a.m.create(spec);
    await new Promise((r) => setTimeout(r, 60));
    expect(a.last().integration).toBe('unavailable');

    const b = setup();
    const { nonce: n } = await b.m.create(spec);
    b.pty.emit(hello(n) + mark(n, 'D', ';0') + mark(n, 'D', ';0') + mark(n, 'D', ';0'));
    expect(b.last().integration).toBe('degraded');
  });

  it('accepts a hello that arrives after the timeout and recovers into block mode', async () => {
    const t = setup({ helloTimeoutMs: 20 });
    const { nonce: n } = await t.m.create(spec);
    await new Promise((r) => setTimeout(r, 60));
    expect(t.last().integration).toBe('unavailable');
    t.pty.emit(hello(n) + mark(n, 'A') + mark(n, 'B'));
    expect(t.last()).toMatchObject({ integration: 'active', phase: 'editing' });
  });

  it('cmd.exe style profiles never claim blocks and keep the working folder', async () => {
    const cmdProfile: ShellProfile = { ...profile, id: 'cmd', env: { kind: 'windows' }, shell: 'cmd', integration: 'cwd-only' };
    const t = setup({ profile: cmdProfile });
    const { nonce: n } = await t.m.create({ ...spec, profileId: 'cmd' });
    expect(t.last()).toMatchObject({ integration: 'unavailable', presentation: 'classic' });
    t.pty.emit(osc(n, `6973;${n};cwdp;C:\\Users\\ผู้ใช้\\proj`));
    expect(t.last().cwd).toEqual({ env: 'windows', path: 'C:\\Users\\ผู้ใช้\\proj' });
  });

  it('reports exit, finishes a running command as unknown and removes the session on close', async () => {
    const { m, pty, last, cmds } = setup();
    const { id, nonce: n } = await m.create(spec);
    pty.emit(hello(n) + mark(n, 'A') + mark(n, 'B') + cmd(n, 1, 'sleep 100') + mark(n, 'C'));
    pty.emitExit(137);
    expect(last()).toMatchObject({ state: 'exited', exit: { code: 137 }, phase: 'unknown' });
    expect(cmds[0]).toMatchObject({ command: 'sleep 100' });
    await m.close(id);
    expect(m.list()).toHaveLength(0);
  });

  it('the activity of an agent names the tab; it goes after a tool call, but not between two that follow each other', async () => {
    vi.useFakeTimers();
    try {
      const { m, pty, last } = setup();
      const { id, nonce: n } = await m.create(spec);
      pty.emit(hello(n) + mark(n, 'A') + mark(n, 'B'));
      m.setActivity(id, 'Show disk space');
      expect(last().agentActivity).toBeUndefined(); // no agent runs in this tab: nothing to show
      pty.emit(cmd(n, 1, 'claude') + mark(n, 'C'));
      m.setActivity(id, 'Show disk space');
      expect(last().agentActivity).toBe('Show disk space');
      m.setActivity(id, null); // PostToolUse
      expect(last().agentActivity).toBe('Show disk space'); // held for a moment
      m.setActivity(id, 'Edit foo.ts'); // the next tool follows at once
      vi.advanceTimersByTime(5000);
      expect(last().agentActivity).toBe('Edit foo.ts');
      m.setActivity(id, null);
      vi.advanceTimersByTime(1300);
      expect(last().agentActivity).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the tab while an agent CLI typed in the shell is running, and clears it afterwards', async () => {
    const { m, pty, last } = setup();
    const { nonce: n } = await m.create(spec);
    pty.emit(hello(n) + mark(n, 'A') + mark(n, 'B'));
    pty.emit(cmd(n, 1, 'cd proj && claude --resume') + mark(n, 'C'));
    expect(last().runningAgent).toMatchObject({ agentId: 'claude-code', command: 'cd proj && claude --resume' });
    pty.emit(mark(n, 'D', ';0') + mark(n, 'A') + mark(n, 'B'));
    expect(last().runningAgent).toBeUndefined();
    pty.emit(cmd(n, 2, 'claude -p hi') + mark(n, 'C'));
    expect(last().runningAgent).toBeUndefined();
    pty.emit(mark(n, 'D', ';0') + mark(n, 'A') + mark(n, 'B') + cmd(n, 3, 'codex') + mark(n, 'C'));
    expect(last().runningAgent?.agentId).toBe('codex');
    pty.emitExit(0);
    expect(last().runningAgent).toBeUndefined();
  });

  it('an agent names its session with its window title; a plain shell does not', async () => {
    const { m, pty, last } = setup();
    const { nonce: n } = await m.create(spec);
    const title = (t: string) => `\x1b]0;${t}\x07`;
    pty.emit(hello(n) + mark(n, 'A') + mark(n, 'B') + title('some shell title'));
    expect(last().agentTopic).toBeUndefined();
    pty.emit(cmd(n, 1, 'claude') + mark(n, 'C') + title('✳ Fix tab status'));
    expect(last().agentTopic).toBe('Fix tab status');
    pty.emit(title('⠂ Fix tab status')); // same subject, other spinner frame
    expect(last().agentTopic).toBe('Fix tab status');
    pty.emit(title('◑ Another subject'));
    expect(last().agentTopic).toBe('Another subject'); // follows the conversation
    pty.emit(title('✳ Claude Code'));
    expect(last().agentTopic).toBeUndefined(); // /clear: the generic name means no subject, the tab's own name is back
    pty.emit(title('◐ Fresh subject'));
    expect(last().agentTopic).toBe('Fresh subject');
    pty.emit(mark(n, 'D', ';0') + mark(n, 'A') + mark(n, 'B'));
    expect(last().agentTopic).toBeUndefined();
  });

  it('close kills the process and resolves', async () => {
    const { m, pty } = setup();
    const { id } = await m.create(spec);
    await m.close(id);
    expect(pty.killed).toBe(true);
    expect(m.get(id)).toBeUndefined();
  });

  it('closing a live tab does not report its exit (the window would show it again for a moment)', async () => {
    const { m, infos } = setup();
    const { id } = await m.create(spec);
    await m.close(id);
    expect(infos.some((i) => i.id === id && i.state === 'exited')).toBe(false);
  });

  it('reports a spawn failure as a failed session instead of throwing', async () => {
    const m = new SessionManager({
      backend: { spawn: () => { throw new Error('spawn ENOENT'); } },
      getProfile: () => profile, toPosix: async () => '/mnt/x', onData: () => {}, onInfo: () => {}
    });
    const info = await m.create(spec);
    expect(info.state).toBe('failed');
    expect(info.exit?.reason).toContain('ENOENT');
  });

  it('rejects unknown profiles and agent launches that are not configured', async () => {
    const { m } = setup();
    await expect(m.create({ ...spec, profileId: 'nope' })).rejects.toThrow('Unknown profile');
    await expect(m.create({ ...spec, kind: 'agent' })).rejects.toThrow();
  });

  it('renames: user titles stick, an empty title returns to automatic', async () => {
    const { m, last } = setup();
    const { id } = await m.create(spec);
    m.rename(id, '  build server  ');
    expect(last()).toMatchObject({ title: 'build server', titleSource: 'user' });
    m.rename(id, '   ');
    expect(last().titleSource).toBe('auto');
  });
});

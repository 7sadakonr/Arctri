import { describe, expect, it } from 'vitest';
import { ShellStateMachine } from './state-machine';

const run = (m: ShellStateMachine) => {
  m.apply({ t: 'hello', shell: 'bash', version: '5', blocks: true }, 0);
  m.apply({ t: 'promptStart' }, 1);
  m.apply({ t: 'inputStart' }, 2);
};

describe('ShellStateMachine', () => {
  it('runs a full command cycle', () => {
    const m = new ShellStateMachine();
    run(m);
    expect(m.phase).toBe('editing');
    m.apply({ t: 'commandLine', commandId: 1, text: 'ls' }, 3);
    const started = m.apply({ t: 'executed' }, 10);
    expect(started).toMatchObject({ kind: 'blockStarted', command: { text: 'ls', startedAt: 10 } });
    expect(m.phase).toBe('executing');
    const fin = m.apply({ t: 'finished', exitCode: 2 }, 25);
    expect(fin).toMatchObject({ kind: 'blockFinished', status: 'failed', exitCode: 2, endedAt: 25 });
    expect(m.phase).toBe('prompt');
  });

  it('marks success and unknown statuses', () => {
    const m = new ShellStateMachine();
    run(m);
    m.apply({ t: 'executed' }, 1);
    expect(m.apply({ t: 'finished', exitCode: 0 }, 2)).toMatchObject({ status: 'success' });
    m.apply({ t: 'inputStart' }, 3);
    m.apply({ t: 'executed' }, 4);
    expect(m.apply({ t: 'finished' }, 5)).toMatchObject({ status: 'unknown' });
  });

  it('finishes a running block as unknown when a new prompt starts without D', () => {
    const m = new ShellStateMachine();
    run(m);
    m.apply({ t: 'commandLine', commandId: 1, text: 'exec zsh' }, 3);
    m.apply({ t: 'executed' }, 4);
    expect(m.apply({ t: 'promptStart' }, 9)).toMatchObject({ kind: 'blockFinished', status: 'unknown' });
    expect(m.phase).toBe('prompt');
  });

  it('rejects out-of-order events instead of inventing blocks', () => {
    const m = new ShellStateMachine();
    expect(m.apply({ t: 'executed' }, 1).kind).toBe('anomaly');
    run(m);
    expect(m.apply({ t: 'finished', exitCode: 0 }, 2).kind).toBe('anomaly');
    m.apply({ t: 'executed' }, 3);
    expect(m.apply({ t: 'executed' }, 4).kind).toBe('anomaly'); // C twice without a command line in between
    expect(m.apply({ t: 'inputStart' }, 5).kind).toBe('anomaly');
  });

  it('merges several commands run from one input buffer into a single block', () => {
    const m = new ShellStateMachine();
    run(m);
    m.apply({ t: 'commandLine', commandId: 1, text: 'echo one' }, 3);
    expect(m.apply({ t: 'executed' }, 4).kind).toBe('blockStarted');
    m.apply({ t: 'commandLine', commandId: 2, text: 'echo two' }, 5);
    expect(m.apply({ t: 'executed' }, 6).kind).toBe('none');
    const fin = m.apply({ t: 'finished', exitCode: 0 }, 7);
    expect(fin).toMatchObject({ kind: 'blockFinished', command: { text: 'echo one\necho two', startedAt: 4 } });
  });

  it('reports a running block when the PTY closes', () => {
    const m = new ShellStateMachine();
    run(m);
    m.apply({ t: 'executed' }, 3);
    expect(m.closed(9)).toMatchObject({ kind: 'blockFinished', status: 'unknown' });
    expect(m.phase).toBe('unknown');
  });

  it('tracks cwd', () => {
    const m = new ShellStateMachine();
    m.apply({ t: 'cwd', path: '/tmp' }, 0);
    expect(m.cwd).toBe('/tmp');
  });

  it('remembers which shell said hello', () => {
    const m = new ShellStateMachine();
    m.apply({ t: 'hello', shell: 'zsh', version: '5.9', blocks: true }, 0);
    expect(m.helloShell).toBe('zsh');
  });
});

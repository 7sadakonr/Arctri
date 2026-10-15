import { describe, expect, it } from 'vitest';
import type { AgentStatusEvent } from '../types/agent-status';
import { afterUserInput, clampEvent, reduceStatus } from './status-rules';

const ev = (o: Partial<AgentStatusEvent>): AgentStatusEvent => ({
  sessionId: 's1', agentId: 'claude-code', state: 'working', timestamp: 100, source: 'claude-hook', confidence: 'high', ...o
});

describe('status rules', () => {
  it('only a high-confidence structured source may claim needs-approval', () => {
    expect(clampEvent(ev({ state: 'needs-approval' })).state).toBe('needs-approval');
    expect(clampEvent(ev({ state: 'needs-approval', confidence: 'medium' })).state).toBe('unknown');
    expect(clampEvent(ev({ state: 'needs-approval', source: 'terminal-signal' })).state).toBe('unknown');
  });

  it('marks attention states unread when nobody is watching, and read when they are', () => {
    expect(reduceStatus(undefined, ev({ state: 'finished' }), false).unread).toBe(true);
    expect(reduceStatus(undefined, ev({ state: 'finished' }), true).unread).toBe(false);
  });

  it('ignores older events and anything after exit', () => {
    const cur = reduceStatus(undefined, ev({ state: 'working', timestamp: 200 }), true);
    expect(reduceStatus(cur, ev({ state: 'finished', timestamp: 100 }), true)).toBe(cur);
    const gone = reduceStatus(cur, ev({ state: 'exited', source: 'pty', timestamp: 300 }), true);
    expect(reduceStatus(gone, ev({ state: 'working', timestamp: 400 }), true)).toBe(gone);
  });

  it('a plain terminal signal does not override a known structured state, and on its own stays unknown', () => {
    const cur = reduceStatus(undefined, ev({ state: 'working' }), true);
    const bell = ev({ state: 'unknown', source: 'terminal-signal', confidence: 'low', timestamp: 150 });
    expect(reduceStatus(cur, bell, false)).toBe(cur);
    const s = reduceStatus(undefined, bell, false);
    expect(s.state).toBe('unknown');
    expect(s.unread).toBe(true);
  });

  it('ordinary typing never changes a pending approval or work in progress', () => {
    const cur = reduceStatus(undefined, ev({ state: 'needs-approval' }), false);
    expect(afterUserInput(cur, 500, 'submit')).toBe(cur);
    const working = reduceStatus(undefined, ev({ state: 'working' }), true);
    expect(afterUserInput(working, 500, 'submit')).toBe(working);
  });

  it('Esc / Ctrl+C on working or approval makes it unknown (interrupted); a finished turn stays finished', () => {
    for (const state of ['working', 'needs-approval'] as const) {
      const after = afterUserInput(reduceStatus(undefined, ev({ state }), true), 500, 'interrupt');
      expect(after.state).toBe('unknown');
      expect(after.reason).toBe('interrupted');
      expect(after.confidence).toBe('low');
      expect(after.unread).toBe(false);
    }
    const finished = reduceStatus(undefined, ev({ state: 'finished' }), true);
    expect(afterUserInput(finished, 500, 'interrupt')).toBe(finished);
  });

  it('Enter after a Codex finished turn is unconfirmed, never working; other agents are untouched', () => {
    const codex = reduceStatus(undefined, ev({ agentId: 'codex', source: 'codex-notify', state: 'finished' }), true);
    const after = afterUserInput(codex, 500, 'submit');
    expect(after.state).toBe('unknown');
    expect(after.reason).toBe('turn-unconfirmed');
    const claude = reduceStatus(undefined, ev({ state: 'finished' }), true);
    expect(afterUserInput(claude, 500, 'submit')).toBe(claude);
  });

  it('a later turn-complete overrides the unconfirmed state', () => {
    const codex = reduceStatus(undefined, ev({ agentId: 'codex', source: 'codex-notify', state: 'finished', timestamp: 100 }), true);
    const unsure = afterUserInput(codex, 200, 'submit');
    expect(reduceStatus(unsure, ev({ agentId: 'codex', source: 'codex-notify', state: 'finished', timestamp: 300 }), true).state).toBe('finished');
  });

  it('an abnormal exit is unread when nobody watches; a clean one is not', () => {
    const bad = reduceStatus(undefined, ev({ state: 'exited', source: 'pty', detail: { event: 'exit', exitCode: 2 } }), false);
    expect(bad.unread).toBe(true);
    const ok = reduceStatus(undefined, ev({ state: 'exited', source: 'pty', detail: { event: 'exit' } }), false);
    expect(ok.unread).toBe(false);
  });
});

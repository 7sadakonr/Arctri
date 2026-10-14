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

  it('typing clears a pending approval to unknown instead of guessing', () => {
    const cur = reduceStatus(undefined, ev({ state: 'needs-approval' }), false);
    const after = afterUserInput(cur, 500);
    expect(after.state).toBe('unknown');
    expect(after.unread).toBe(false);
    expect(afterUserInput(reduceStatus(undefined, ev({ state: 'working' }), true), 500).state).toBe('working');
  });

  it('Esc / Ctrl+C while working makes it unknown (no stop event is sent on interrupt); other typing does not', () => {
    const working = reduceStatus(undefined, ev({ state: 'working' }), true);
    expect(afterUserInput(working, 500, 'any').state).toBe('working');
    expect(afterUserInput(working, 500, 'interrupt').state).toBe('unknown');
    const finished = reduceStatus(undefined, ev({ state: 'finished' }), true);
    expect(afterUserInput(finished, 500, 'interrupt').state).toBe('finished');
  });
});

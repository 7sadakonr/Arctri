import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../types/agent-status';
import { NotificationLedger, notificationFor } from './notification';

const st = (o: Partial<AgentStatus>): AgentStatus => ({
  sessionId: 's', agentId: 'claude-code', state: 'finished', timestamp: 1, source: 'claude-hook', confidence: 'high', since: 1, unread: true, ...o
});

describe('notification identity', () => {
  it('announces approvals, questions, finished turns, abnormal exits and bare signals; nothing else', () => {
    expect(notificationFor(st({ state: 'needs-approval' }))?.kind).toBe('needs-approval');
    expect(notificationFor(st({ state: 'waiting' }))?.kind).toBe('waiting');
    expect(notificationFor(st({ state: 'finished' }))?.kind).toBe('finished');
    expect(notificationFor(st({ state: 'exited', detail: { event: 'exit', exitCode: 1 } }))?.kind).toBe('error');
    expect(notificationFor(st({ state: 'unknown', source: 'terminal-signal' }))?.kind).toBe('hint');
    expect(notificationFor(st({ state: 'exited' }))).toBeNull();
    expect(notificationFor(st({ state: 'working' }))).toBeNull();
    expect(notificationFor(st({ state: 'unknown' }))).toBeNull();
  });

  it('a read status raises nothing', () => {
    expect(notificationFor(st({ unread: false }))).toBeNull();
  });

  it('a new approval right after a finished turn is not lost to a time window', () => {
    const ledger = new NotificationLedger();
    const done = notificationFor(st({ state: 'finished', since: 100 }))!;
    const ask = notificationFor(st({ state: 'needs-approval', since: 101 }))!;
    expect(ledger.claim('s', done.key)).toBe(true);
    expect(ledger.claim('s', ask.key)).toBe(true);
  });

  it('the same event is announced once; a later turn with the same state is a new event', () => {
    const ledger = new NotificationLedger();
    const a = notificationFor(st({ since: 100 }))!;
    expect(ledger.claim('s', a.key)).toBe(true);
    expect(ledger.claim('s', notificationFor(st({ since: 100, timestamp: 5 }))!.key)).toBe(false);
    expect(ledger.claim('s', notificationFor(st({ since: 900 }))!.key)).toBe(true);
  });

  it('tabs are independent and forgetting a tab resets it', () => {
    const ledger = new NotificationLedger();
    const k = notificationFor(st({ since: 5 }))!.key;
    expect(ledger.claim('a', k)).toBe(true);
    expect(ledger.claim('b', k)).toBe(true);
    ledger.forget('a');
    expect(ledger.claim('a', k)).toBe(true);
  });
});

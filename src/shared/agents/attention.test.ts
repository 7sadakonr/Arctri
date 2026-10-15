import { describe, expect, it } from 'vitest';
import { attentionCounts } from './attention';

describe('attention counts', () => {
  it('counts each unresolved item once, read or not, and unread news once', () => {
    const c = attentionCounts([
      { status: 'approval', unread: true }, { status: 'approval', unread: false }, { status: 'waiting', unread: true },
      { status: 'finished', unread: true }, { status: 'finished', unread: false }
    ]);
    expect(c).toEqual({ unresolved: 3, unread: 1, total: 4 });
  });

  it('a read error stays read when its tab is not in front; a new unread error counts', () => {
    expect(attentionCounts([{ status: 'error', unread: false }]).total).toBe(0);
    expect(attentionCounts([{ status: 'error', unread: true }]).total).toBe(1);
  });

  it('marking everything read leaves unresolved items', () => {
    const after = attentionCounts([{ status: 'approval', unread: false }, { status: 'finished', unread: false }]);
    expect(after).toEqual({ unresolved: 1, unread: 0, total: 1 });
  });

  it('other states are never listed or counted', () => {
    expect(attentionCounts([{ status: 'working', unread: true }, { status: 'unknown', unread: true }]).total).toBe(0);
  });
});

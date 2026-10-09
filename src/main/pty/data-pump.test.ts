import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataPump } from './data-pump';

describe('DataPump', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('batches small chunks into one message per interval, in order', () => {
    const sent: string[] = [];
    const p = new DataPump((c) => sent.push(c), () => {}, () => {});
    p.push('a');
    p.push('b');
    p.push('c');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(sent).toEqual(['abc']);
  });

  it('flushes at once when a batch is large', () => {
    const sent: string[] = [];
    const p = new DataPump((c) => sent.push(c), () => {}, () => {}, { intervalMs: 8, maxBatch: 10, high: 1e9, low: 1 });
    p.push('x'.repeat(10));
    expect(sent).toHaveLength(1);
  });

  it('pauses the PTY above the high-water mark and resumes below the low-water mark', () => {
    const events: string[] = [];
    const p = new DataPump((c) => events.push(`send${c.length}`), () => events.push('pause'), () => events.push('resume'), {
      intervalMs: 1, maxBatch: 100, high: 250, low: 100
    });
    for (let i = 0; i < 3; i++) p.push('y'.repeat(100));
    expect(events).toEqual(['send100', 'send100', 'send100', 'pause']);
    p.ack(100);
    p.ack(100);
    expect(events).not.toContain('resume'); // 100 still outstanding is not below the low mark
    p.ack(50);
    expect(events.at(-1)).toBe('resume');
    p.ack(1000); // over-acknowledging never goes negative
    p.push('z'.repeat(100));
    expect(events.filter((e) => e === 'pause')).toHaveLength(1);
  });
});

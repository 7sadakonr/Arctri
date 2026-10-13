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

  describe('after dispose', () => {
    it('ignores push, flush and ack', () => {
      const sent: string[] = [];
      const p = new DataPump((c) => sent.push(c), () => {}, () => {});
      p.dispose();
      p.push('late');
      p.flush();
      vi.advanceTimersByTime(50);
      p.ack(10);
      expect(sent).toEqual([]);
    });

    it('resumes a paused PTY so a dying process is not left frozen', () => {
      const events: string[] = [];
      const p = new DataPump(() => {}, () => events.push('pause'), () => events.push('resume'), {
        intervalMs: 1, maxBatch: 10, high: 5, low: 1
      });
      p.push('x'.repeat(10));
      expect(events).toEqual(['pause']);
      p.dispose();
      expect(events).toEqual(['pause', 'resume']);
    });
  });

  describe('resetCredit', () => {
    it('forgets what is outstanding and resumes a paused PTY', () => {
      const events: string[] = [];
      const p = new DataPump(() => {}, () => events.push('pause'), () => events.push('resume'), {
        intervalMs: 1, maxBatch: 10, high: 5, low: 1
      });
      p.push('x'.repeat(10));
      p.resetCredit();
      expect(events).toEqual(['pause', 'resume']);
      p.push('y'.repeat(10)); // credit starts from zero again, so it pauses again
      expect(events).toEqual(['pause', 'resume', 'pause']);
    });

    it('does nothing when the PTY is not paused', () => {
      const events: string[] = [];
      const p = new DataPump(() => {}, () => events.push('pause'), () => events.push('resume'));
      p.resetCredit();
      expect(events).toEqual([]);
    });
  });

  describe('ack watchdog', () => {
    const make = (events: string[]) =>
      new DataPump(() => {}, () => events.push('pause'), () => events.push('resume'), {
        intervalMs: 1, maxBatch: 10, high: 5, low: 1, stallMs: 1000, onStall: () => events.push('stall')
      });

    it('gives up waiting after stallMs while paused: reports it and resumes', () => {
      const events: string[] = [];
      const p = make(events);
      p.push('x'.repeat(10));
      vi.advanceTimersByTime(999);
      expect(events).toEqual(['pause']);
      vi.advanceTimersByTime(2);
      expect(events).toEqual(['pause', 'stall', 'resume']);
    });

    it('is restarted by every ack, so a slow but live renderer is never reset', () => {
      const events: string[] = [];
      const p = make(events);
      p.push('x'.repeat(40)); // outstanding 40, paused
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(900);
        p.ack(1);
      }
      expect(events).toEqual(['pause']);
    });

    it('is cancelled when the PTY resumes through acks', () => {
      const events: string[] = [];
      const p = make(events);
      p.push('x'.repeat(10));
      p.ack(10);
      vi.advanceTimersByTime(5000);
      expect(events).toEqual(['pause', 'resume']);
    });

    it('does not run while the PTY is not paused', () => {
      const events: string[] = [];
      const p = make(events);
      p.push('x');
      vi.advanceTimersByTime(60_000);
      expect(events).toEqual([]);
    });
  });

  it('moves 100 MB through a slow consumer without losing or reordering a byte, and never has much in flight', () => {
    const TOTAL = 100 * 1024 * 1024;
    const HIGH = 2 * 1024 * 1024;
    const inbox: string[] = [];
    let paused = false;
    const pump = new DataPump((c) => inbox.push(c), () => (paused = true), () => (paused = false));
    let produced = 0;
    let consumed = 0;
    let checksumOut = 0;
    let checksumIn = 0;
    let maxInFlight = 0;
    const line = (n: number) => `${n.toString(36)}\n`.padEnd(64, '.');
    let n = 0;
    // The PTY writes 16 KB at a time whenever it is not paused; the page handles one 64 KB batch per tick.
    while (consumed < TOTAL) {
      while (!paused && produced < TOTAL) {
        let chunk = '';
        while (chunk.length < 16 * 1024) chunk += line(n++);
        chunk = chunk.slice(0, Math.min(chunk.length, TOTAL - produced));
        for (let i = 0; i < chunk.length; i += 1024) checksumIn = (checksumIn * 31 + chunk.charCodeAt(i)) >>> 0;
        produced += chunk.length;
        pump.push(chunk);
        maxInFlight = Math.max(maxInFlight, produced - consumed);
      }
      pump.flush();
      const batch = inbox.shift();
      if (batch) {
        for (let i = 0; i < batch.length; i += 1024) checksumOut = (checksumOut * 31 + batch.charCodeAt(i)) >>> 0;
        consumed += batch.length;
        pump.ack(batch.length);
      } else if (produced >= TOTAL) break;
    }
    expect(consumed).toBe(TOTAL);
    expect(checksumOut).toBe(checksumIn);
    expect(maxInFlight).toBeLessThan(HIGH + 256 * 1024);
  });
});

import { describe, expect, it } from 'vitest';
import { descendants, parsePs } from './process-cleanup';

const TABLE = `    1     0 Mon Jan  1 10:00:00 2024
  100     1 Mon Jan  1 10:01:00 2024
  101   100 Mon Jan  1 10:01:05 2024
  102   101 Mon Jan  1 10:01:09 2024
  200     1 Mon Jan  1 10:02:00 2024
`;

describe('process table', () => {
  it('reads pid, parent pid and start time', () => {
    const rows = parsePs(TABLE);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toEqual({ pid: 101, ppid: 100, started: 'Mon Jan 1 10:01:05 2024' });
  });
  it('finds a process and everything below it, and nothing beside it', () => {
    const pids = descendants(100, parsePs(TABLE)).map((r) => r.pid);
    expect(pids).toEqual([100, 101, 102]);
    expect(descendants(999, parsePs(TABLE))).toEqual([]);
  });
});

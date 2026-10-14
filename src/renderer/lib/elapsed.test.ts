import { describe, expect, it } from 'vitest';
import { formatElapsed } from './elapsed';

describe('formatElapsed', () => {
  it('seconds, minutes, hours', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(45_000)).toBe('45s');
    expect(formatElapsed(155_000)).toBe('2m 35s');
    expect(formatElapsed(3_720_000)).toBe('1h 02m');
    expect(formatElapsed(-5)).toBe('0s');
  });
});

import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const now = Date.UTC(2026, 9, 11, 12, 0, 0);
const ago = (seconds: number) => now / 1000 - seconds;

describe('relativeTime', () => {
  it('says it in whole words, in English', () => {
    expect(relativeTime(ago(5), 'en', now)).toBe('just now');
    expect(relativeTime(ago(60), 'en', now)).toBe('1 minute ago');
    expect(relativeTime(ago(5 * 60), 'en', now)).toBe('5 minutes ago');
    expect(relativeTime(ago(3600), 'en', now)).toBe('1 hour ago');
    expect(relativeTime(ago(3 * 3600), 'en', now)).toBe('3 hours ago');
    expect(relativeTime(ago(2 * 86400), 'en', now)).toBe('2 days ago');
  });

  it('says it in whole words, in Thai', () => {
    expect(relativeTime(ago(5), 'th', now)).toBe('เมื่อสักครู่');
    expect(relativeTime(ago(2 * 3600), 'th', now)).toBe('2 ชั่วโมงที่แล้ว');
    expect(relativeTime(ago(86400), 'th', now)).toBe('1 วันที่แล้ว');
  });

  it('uses a date once it is a month old', () => {
    expect(relativeTime(ago(40 * 86400), 'en', now)).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

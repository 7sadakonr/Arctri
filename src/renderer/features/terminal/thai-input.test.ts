import { describe, expect, it } from 'vitest';
import { ThaiInputTracker } from './thai-input';

const typed = (s: string) => {
  const t = new ThaiInputTracker();
  for (const ch of s) t.feed(ch);
  return t;
};

describe('ThaiInputTracker', () => {
  it('keeps the consonant when a mark is deleted', () => {
    expect(typed('กิ').backspace()).toBe('ก');
  });
  it('keeps the vowel when a tone mark is deleted', () => {
    expect(typed('กิ่').backspace()).toBe('กิ');
  });
  it('follows a second Backspace after the first', () => {
    const t = typed('กิ่');
    expect(t.backspace()).toBe('กิ');
    expect(t.backspace()).toBe('ก');
    expect(t.backspace()).toBeUndefined();
  });
  it('lets a plain Backspace through when no mark is before the caret', () => {
    expect(typed('ก').backspace()).toBeUndefined();
    expect(typed('abc').backspace()).toBeUndefined();
    expect(typed('').backspace()).toBeUndefined();
  });
  it('removes the whole cluster on an ordinary Backspace it did not handle', () => {
    const t = typed('กิ');
    t.feed('\x7f');
    expect(t.backspace()).toBeUndefined();
    t.feed('นิ');
    expect(t.backspace()).toBe('น');
  });
  it('stops answering after cursor keys or a paste until the line is submitted', () => {
    const t = typed('กิ');
    t.feed('\x1b[D');
    expect(t.backspace()).toBeUndefined();
    t.feed('\r');
    t.feed('กิ');
    expect(t.backspace()).toBe('ก');
  });
  it('ignores focus reports', () => {
    const t = typed('กิ');
    t.feed('\x1b[I');
    expect(t.backspace()).toBe('ก');
  });
});

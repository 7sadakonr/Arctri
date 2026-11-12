import { describe, expect, it } from 'vitest';
import { middleEllipsis } from './attachment-name';

const len = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;

describe('middleEllipsis', () => {
  it('leaves a short name alone', () => {
    expect(middleEllipsis('a.png', 28)).toBe('a.png');
  });

  it('keeps the start and the extension of a long name', () => {
    const out = middleEllipsis('Screenshot 2026-11-12 at 03.52.59.png', 24);
    expect(Array.from(out)).toHaveLength(24);
    expect(out.startsWith('Screenshot')).toBe(true);
    expect(out.endsWith('.png')).toBe(true);
    expect(out).toContain('…');
  });

  it('keeps more than the extension at the end, so two similar names differ', () => {
    expect(middleEllipsis('Screenshot 2026-11-12 at 03.52.59.png', 20).endsWith('59.png')).toBe(true);
  });

  it('works for names without an extension', () => {
    const out = middleEllipsis('a-very-long-file-name-without-extension', 15);
    expect(Array.from(out)).toHaveLength(15);
    expect(out.startsWith('a-very')).toBe(true);
  });

  it('never splits a Thai character', () => {
    const out = middleEllipsis('ภาพหน้าจอที่ยาวมากๆ สำหรับทดสอบ.png', 16);
    expect(len(out)).toBe(16);
    expect(out.endsWith('.png')).toBe(true);
  });
});

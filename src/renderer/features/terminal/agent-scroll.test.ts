import { describe, expect, it } from 'vitest';
import { AgentScroll, measureShift, scrollCue } from './agent-scroll';

const lines = (from: number, n: number) => Array.from({ length: n }, (_, i) => `line number ${from + i}`);

describe('measureShift', () => {
  it('0 when nothing moved', () => {
    expect(measureShift(lines(10, 20), lines(10, 20))).toBe(0);
  });
  it('positive when the text moved down (older text came in), negative when up', () => {
    const all = lines(0, 100);
    expect(measureShift(all.slice(40, 60), all.slice(37, 57))).toBe(3);
    expect(measureShift(all.slice(40, 60), all.slice(52, 72))).toBe(-12);
  });
  it('repeated lines (a transcript full of the same tool error) do not fool it', () => {
    // every 3rd row is a repeated line, the others are unique
    const screen = (from: number) => Array.from({ length: 24 }, (_, i) => ((from + i) % 3 === 0 ? 'Failed with non-blocking status code' : `unique line ${from + i}`));
    expect(measureShift(screen(100), screen(97))).toBe(3);
    expect(measureShift(screen(100), screen(112))).toBe(-12);
    expect(measureShift(screen(100), screen(100))).toBe(0);
  });
  it('only repeated lines: cannot tell', () => {
    const same = Array.from({ length: 10 }, () => 'Failed with non-blocking status code');
    expect(measureShift(same, same)).toBeUndefined();
  });
  it('whole-screen jumps cannot be told', () => {
    expect(measureShift(lines(0, 20), lines(50, 20))).toBeUndefined();
  });
  it('rules, blanks and the cue itself are not used to recognise rows', () => {
    const rule = '─'.repeat(40);
    const a = [...lines(0, 10), rule, 'Jump to bottom (click) ↓', ''];
    const b = [...lines(0, 10), rule, 'Jump to bottom (click) ↓', ''];
    expect(measureShift(a, b)).toBe(0);
    expect(measureShift(['', rule, ''], ['', rule, ''])).toBeUndefined();
  });
});

describe('AgentScroll', () => {
  const CUE = 'Jump to bottom (click) ↓';
  it('rests at the bottom of the track, not scrolled', () => {
    const t = new AgentScroll().thumb(400, 30);
    expect(t.scrolled).toBe(false);
    expect(t.top + t.height).toBe(400);
  });
  it('follows measured shifts linearly, and comes back when the cue disappears', () => {
    const s = new AgentScroll();
    const tops: number[] = [];
    for (let i = 0; i < 5; i++) {
      s.screen(CUE, 12);
      tops.push(s.thumb(400, 30).top);
    }
    const steps = tops.slice(1).map((t, i) => tops[i]! - t);
    // equal scrolls move the thumb equally (within rounding) while the top is still unknown
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThanOrEqual(2);
    s.screen('');
    expect(s.thumb(400, 30).scrolled).toBe(false);
  });
  it('a wheel without the cue is dropped by the next look, but a look right after input waits for the cue', () => {
    const s = new AgentScroll();
    s.wheel(-3);
    s.screen('', undefined, true);
    s.screen(CUE, 3);
    expect(s.thumb(400, 30).scrolled).toBe(true);
    const t = new AgentScroll();
    t.wheel(-3);
    t.screen('');
    expect(t.thumb(400, 30).scrolled).toBe(false);
  });
  it('input that was not measured is counted as it was sent', () => {
    const s = new AgentScroll();
    s.key('PageUp');
    s.screen(CUE);
    const a = s.thumb(400, 30).top;
    s.key('PageUp');
    s.screen(CUE);
    expect(s.thumb(400, 30).top).toBeLessThan(a);
  });
  it('input that moved nothing at the top marks the top: the thumb then reaches the top of the track', () => {
    const s = new AgentScroll();
    s.screen(CUE, 40);
    s.key('PageUp');
    s.screen(CUE, 0);
    expect(s.thumb(400, 30).top).toBe(0);
  });
  it('a measured shift against what was just sent is not believed', () => {
    const s = new AgentScroll();
    s.screen(CUE, 24);
    const a = s.thumb(400, 30).top;
    s.key('PageUp');
    s.screen(CUE, -5); // a mismeasure
    expect(s.thumb(400, 30).top).toBeLessThan(a);
  });
  it('text that has not moved yet right after input is not the top', () => {
    const s = new AgentScroll();
    s.screen(CUE, 40);
    s.key('PageUp');
    s.screen(CUE, 0, true); // too early: the agent has not drawn yet
    s.screen(CUE, 12); // now it moved
    expect(s.thumb(400, 30).top).toBeGreaterThan(0);
  });
  it('scrolling down never goes below the bottom; Home / End do not count', () => {
    const s = new AgentScroll();
    s.key('End');
    s.key('Home');
    s.screen('');
    expect(s.thumb(400, 30).scrolled).toBe(false);
    s.screen(CUE, 12);
    s.screen(CUE, -50);
    expect(s.thumb(400, 30).scrolled).toBe(true); // the cue says it is still up
    s.screen('', -12);
    expect(s.thumb(400, 30).scrolled).toBe(false);
  });
  it('dragging the thumb: pages up above it, pages down below it, none where it is', () => {
    const s = new AgentScroll();
    expect(s.pagesTo(s.thumb(400, 30).top, 400, 30)).toBe(0);
    expect(s.pagesTo(100, 400, 30)).toBeGreaterThan(0);
    s.screen(CUE, 60);
    const here = s.thumb(400, 30).top;
    expect(s.pagesTo(here, 400, 30)).toBe(0);
    expect(s.pagesTo(here - 80, 400, 30)).toBeGreaterThan(0);
    expect(s.pagesTo(here + 80, 400, 30)).toBeLessThan(0);
    // pages already sent but not yet seen count
    s.key('PageUp');
    expect(s.pagesTo(here, 400, 30)).toBe(-1);
  });
  it('dragging all the way down asks for pages down until the bottom', () => {
    const s = new AgentScroll();
    s.screen(CUE, 48);
    const pages = s.pagesTo(400, 400, 30);
    expect(pages).toBeLessThan(0);
  });
});

describe('scrollCue', () => {
  it('finds the cue at the end of a row, also after transcript text', () => {
    expect(scrollCue('Jump to bottom (click) ↓')).toBeDefined();
    expect(scrollCue('directory                       Jump to bottom (click) ↓')).toBeDefined();
    expect(scrollCue('  3 new messages ↓')).toBeDefined();
    expect(scrollCue('Jump to bottom: fn+↓ to scroll')).toBeDefined();
    expect(scrollCue('3 new messages: ctrl+End to scroll')).toBeDefined();
  });
  it('ignores a sentence that only mentions it', () => {
    expect(scrollCue('Claude shows Jump to bottom when you scroll up and then more text follows here')).toBeUndefined();
    expect(scrollCue('❯')).toBeUndefined();
  });
});

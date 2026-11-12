import { describe, expect, it } from 'vitest';
import { planRemoval, planRemovalRows, type RowCell } from './attachment-remove';

const row = (s: string, inverseAt = -1): RowCell[] => [...s].map((ch, x) => ({ x, ch, inverse: x === inverseAt }));

describe('planRemoval', () => {
  it('caret right after the text: nothing to move', () => {
    expect(planRemoval(row('❯ [Image #3] '), '[Image #3]', 12)).toEqual({ moves: 0, width: 10 });
  });
  it('caret further right: Left presses (negative)', () => {
    expect(planRemoval(row('❯ [Image #3] and more'), '[Image #3]', 21)).toEqual({ moves: -9, width: 10 });
  });
  it('caret before the text: Right presses', () => {
    expect(planRemoval(row('❯ look [Image #3]'), '[Image #3]', 2)).toEqual({ moves: 15, width: 10 });
  });
  it('a caret inside the text goes on to its end (it is walked through on the way)', () => {
    expect(planRemoval(row('❯ [Image #3]'), '[Image #3]', 6)).toEqual({ moves: 6, width: 10 });
  });
  it('refuses text that is not there', () => {
    expect(planRemoval(row('❯ hello'), '[Image #3]', 7)).toBeUndefined();
  });
  it('finds the caret as an inverse cell when the terminal cursor is hidden', () => {
    expect(planRemoval(row('❯ [Image #3] ', 12), '[Image #3]', undefined)).toEqual({ moves: 0, width: 10 });
    expect(planRemoval(row('❯ [Image #3]'), '[Image #3]', undefined)).toBeUndefined();
  });
  it('picks the right one of two placeholders in a row, caret behind the last', () => {
    const r = row('❯ [Image #1] [Image #2] ');
    expect(planRemoval(r, '[Image #2]', 24)).toEqual({ moves: -1, width: 10 });
    expect(planRemoval(r, '[Image #1]', 24)).toEqual({ moves: -12, width: 10 });
  });
  it('after one Left jumped the whole last placeholder, the caret is before it and one Right brings it back', () => {
    expect(planRemoval(row('❯ [Image #1] [Image #2] '), '[Image #2]', 13)).toEqual({ moves: 10, width: 10 });
  });
});

describe('planRemovalRows: an @path wrapped over two rows', () => {
  const rowsOf = (lines: string[], cursor?: { row: number; x: number }) =>
    lines.map((s, r) => ({ cells: row(s), cursorX: cursor?.row === r ? cursor.x : undefined }));
  const needle = '@"/tmp/scratchpad/Screenshot long name test 2026.png"';

  it('finds it when the wrap swallowed a space, caret behind it on the second row', () => {
    // the agent wraps at the space between "name" and "test"; the second row is indented under the text
    const plan = planRemovalRows(rowsOf(['❯ @"/tmp/scratchpad/Screenshot long name     ', '  test 2026.png" '], { row: 1, x: 16 }), needle);
    expect(plan).toEqual({ moves: 0, width: needle.length });
  });
  it('finds it when a word is cut in the middle (no space lost)', () => {
    const plan = planRemovalRows(rowsOf(['❯ @"/tmp/scratchpad/Screens', '  hot long name test 2026.png" '], { row: 1, x: 30 }), needle);
    expect(plan).toEqual({ moves: 0, width: needle.length });
  });
  it('caret further on the second row: Left presses to just behind the space that follows it', () => {
    expect(planRemovalRows(rowsOf(['❯ @"/tmp/scratchpad/Screenshot long name', '  test 2026.png" more'], { row: 1, x: 21 }), needle)).toEqual({
      moves: -4,
      width: needle.length + 1
    });
  });
  it('caret on the row before the text: Right presses', () => {
    const plan = planRemovalRows(rowsOf(['❯ hi', '  @"/tmp/scratchpad/Screenshot long name', '  test 2026.png"'], { row: 0, x: 2 }), needle);
    expect(plan!.moves).toBeGreaterThan(0);
  });
  it('a caret inside the wrapped text goes on to its end', () => {
    expect(planRemovalRows(rowsOf(['❯ @"/tmp/scratchpad/Screenshot long name', '  test 2026.png"'], { row: 1, x: 5 }), needle)).toEqual({
      moves: 11,
      width: needle.length
    });
  });
});

describe('planRemovalRows: several attachments, removed by position', () => {
  const COLS = 140;
  // rows as the terminal has them: padded to the full width
  const rowsOf = (lines: string[], cursor?: { row: number; x: number }) =>
    lines.map((s, r) => ({ cells: row(s.padEnd(COLS)), cursorX: cursor?.row === r ? cursor.x : undefined }));
  const shot = '@"/private/tmp/scratchpad/Screenshot long name test 2026-11-12 at 03.59.48.png"';
  // what Claude showed for README.md + a long screenshot path + AgentBar.tsx: the long path moved to its own row and wrapped
  const screen = [
    '❯ @README.md',
    '  @"/private/tmp/scratchpad/Screenshot long name',
    '  test 2026-11-12 at 03.59.48.png" @src/renderer/features/agents/AgentBar.tsx ',
    '─'.repeat(COLS)
  ];
  const caretAtEnd = { row: 2, x: screen[2]!.length };

  it('never starts a match in the padding of the row before (regression: every blank cell used to "match")', () => {
    expect(planRemovalRows(rowsOf(screen, caretAtEnd), shot)).toBeDefined();
  });
  it('the middle one: Left presses to just behind it, the space after it included', () => {
    const plan = planRemovalRows(rowsOf(screen, caretAtEnd), shot)!;
    // the caret is behind "AgentBar.tsx " and must come back over it and the space before it
    expect(plan.moves).toBe(-('@src/renderer/features/agents/AgentBar.tsx '.length));
    expect(plan.width).toBe(shot.length + 1);
  });
  it('the last one: the trailing space before the caret goes too', () => {
    expect(planRemovalRows(rowsOf(screen, caretAtEnd), '@src/renderer/features/agents/AgentBar.tsx')).toEqual({ moves: 0, width: 43 });
  });
  it('the first one, two rows up: an estimate pointing left that is not inflated by row padding', () => {
    const plan = planRemovalRows(rowsOf(screen, caretAtEnd), '@README.md')!;
    expect(plan.moves).toBeLessThan(0);
    expect(-plan.moves).toBeLessThan(200);
    expect(plan.width).toBe('@README.md'.length);
  });
  it('a path is not found inside a longer one', () => {
    const rows = rowsOf(['❯ @src/a.tsx @src/a.ts '], { row: 0, x: 23 });
    expect(planRemovalRows(rows, '@src/a.ts')).toEqual({ moves: 0, width: 10 });
    expect(planRemovalRows(rows, '@src/a.tsx')).toEqual({ moves: -10, width: 11 });
  });
  it('after the first one was removed the caret stands at the start of the next: Right presses through it', () => {
    // "@README.md " was deleted from the front, so the caret is right before "@AgentBar.tsx "
    const rows = rowsOf(['❯\u00a0@AgentBar.tsx '], { row: 0, x: 2 });
    expect(planRemovalRows(rows, '@AgentBar.tsx')).toEqual({ moves: 13, width: 13 });
    // one Right later it is inside the text: still a plan, not a refusal
    expect(planRemovalRows(rowsOf(['❯\u00a0@AgentBar.tsx '], { row: 0, x: 3 }), '@AgentBar.tsx')).toEqual({ moves: 12, width: 13 });
  });
  it('the same file twice: occurrence picks which', () => {
    const rows = rowsOf(['❯ @a.ts @b.ts @a.ts '], { row: 0, x: 20 });
    expect(planRemovalRows(rows, '@a.ts', 0)).toEqual({ moves: -12, width: 6 });
    expect(planRemovalRows(rows, '@a.ts', 1)).toEqual({ moves: 0, width: 6 });
    expect(planRemovalRows(rows, '@a.ts', 2)).toBeUndefined();
  });
  it('Claude Code puts a no-break space after its prompt: a path right after it still stands alone', () => {
    const rows = rowsOf(['❯\u00a0@README.md @src/AgentBar.tsx '], { row: 0, x: 31 });
    expect(planRemovalRows(rows, '@README.md')).toEqual({ moves: -18, width: 11 });
  });
  it('a path at the end of the message without a space after it: nothing extra', () => {
    expect(planRemovalRows(rowsOf(['❯ @a.ts @b.ts'], { row: 0, x: 13 }), '@b.ts')).toEqual({ moves: 0, width: 5 });
  });
});

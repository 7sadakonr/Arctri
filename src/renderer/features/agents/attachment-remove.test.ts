import { describe, expect, it } from 'vitest';
import { planRemoval, type RowCell } from './attachment-remove';

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
  it('refuses a caret inside the text', () => {
    expect(planRemoval(row('❯ [Image #3]'), '[Image #3]', 6)).toBeUndefined();
  });
  it('refuses text that is not there or is there twice', () => {
    expect(planRemoval(row('❯ hello'), '[Image #3]', 7)).toBeUndefined();
    expect(planRemoval(row('❯ [Image #3] [Image #3]'), '[Image #3]', 3)).toBeUndefined();
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

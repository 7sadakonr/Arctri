import { describe, expect, it } from 'vitest';
import { GRACE_MS, inputRegion, reconcile, type InputPatterns, type TrackedAttachment } from './attachment-tracker';

const claude: InputPatterns = { prompt: /^\s*[│|]?\s*>/, placeholder: /\[Image #\d+\]/g };

const att = (over: Partial<TrackedAttachment> = {}): TrackedAttachment => ({
  id: '1', ref: '@docs/a.png', name: 'a.png', image: true, addedAt: 0, tokensBefore: [], seen: false, ...over
});

describe('inputRegion', () => {
  it('starts at the last prompt line', () => {
    expect(inputRegion(['> old', 'answer', '│ > new │', 'footer'], claude.prompt)).toBe('│ > new │\nfooter');
  });
  it('is undefined without a prompt', () => {
    expect(inputRegion(['working...'], claude.prompt)).toBeUndefined();
  });
});

describe('reconcile', () => {
  it('keeps an attachment whose ref is in the message, even when the path wraps', () => {
    const out = reconcile(['│ > look at @docs/', '│   a.png │'], [att()], claude, 10);
    expect(out).toHaveLength(1);
    expect(out[0]!.seen).toBe(true);
  });
  it('binds the placeholder the agent made of the path', () => {
    const out = reconcile(['> [Image #1]'], [att()], claude, 10);
    expect(out[0]!.token).toBe('[Image #1]');
  });
  it('does not bind a placeholder that was already there', () => {
    const out = reconcile(['> [Image #1]'], [att({ tokensBefore: ['[Image #1]'] })], claude, 10);
    expect(out[0]!.token).toBeUndefined();
  });
  it('drops it once the user deleted it from the message', () => {
    const seen = att({ seen: true, token: '[Image #1]' });
    expect(reconcile(['> hello'], [seen], claude, 10)).toEqual([]);
  });
  it('drops it after the message was sent (a new empty prompt)', () => {
    const seen = att({ seen: true });
    expect(reconcile(['> @docs/a.png', 'answer', '> '], [seen], claude, 10)).toEqual([]);
  });
  it('waits for the agent to draw it, then gives up', () => {
    const fresh = att();
    expect(reconcile(['> '], [fresh], claude, 100)).toHaveLength(1);
    expect(reconcile(['> '], [fresh], claude, GRACE_MS + 1)).toEqual([]);
  });
  it('changes nothing when no prompt is showing', () => {
    const list = [att({ seen: true })];
    expect(reconcile(['Allow this command?'], list, claude, 10)).toBe(list);
  });
});

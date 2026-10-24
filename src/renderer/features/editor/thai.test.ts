import { describe, expect, it } from 'vitest';
import { deleteBackward } from './thai';

describe('deleteBackward', () => {
  it('removes only the vowel after a consonant', () => {
    expect(deleteBackward('กิ', 2)).toEqual({ text: 'ก', caret: 1 });
  });
  it('removes a tone mark before the vowel', () => {
    expect(deleteBackward('กิ่', 3)).toEqual({ text: 'กิ', caret: 2 });
  });
  it('works in the middle of the text', () => {
    expect(deleteBackward('aกิb', 3)).toEqual({ text: 'aกb', caret: 2 });
  });
  it('leaves other characters to the browser', () => {
    expect(deleteBackward('ก', 1)).toBeUndefined();
    expect(deleteBackward('abc', 3)).toBeUndefined();
    expect(deleteBackward('กิ', 0)).toBeUndefined();
  });
});

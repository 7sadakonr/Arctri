const THAI_NON_SPACING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;

/** Backspace over a Thai vowel or tone mark removes just that mark; the browser would take the consonant with it. */
export function deleteBackward(text: string, caret: number): { text: string; caret: number } | undefined {
  if (caret < 1 || !THAI_NON_SPACING.test(text[caret - 1]!)) return undefined;
  return { text: text.slice(0, caret - 1) + text.slice(caret), caret: caret - 1 };
}

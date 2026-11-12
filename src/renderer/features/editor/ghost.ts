/**
 * The grey text to show after the caret, worked out from the whole predicted line on every render. Because it follows the text
 * as typed, a character that matches the prediction just shortens it and a different one hides it at once, instead of the old
 * suffix sitting shifted next to the new text until the next answer arrives.
 */
export function visibleGhost(text: string, full: string, caretAtEnd: boolean): string {
  if (!full || !caretAtEnd || text.includes('\n') || full.length <= text.length || !full.startsWith(text)) return '';
  return full.slice(text.length);
}

/** One character cell of a screen row. */
export interface RowCell {
  x: number;
  ch: string;
  inverse: boolean;
}

/** `moves` is how far the caret must go to stand right after the text: positive = Right presses, negative = Left presses. */
export interface RemovalPlan {
  moves: number;
  /** Characters the text takes. */
  width: number;
}

/**
 * Where the caret is relative to `needle` (an `@path` or an `[Image #N]`) on one row, so that deleting it from the agent's
 * message box can be done with arrow keys and Backspace. Undefined when it cannot be done safely: the text is not on the
 * row (or twice), the caret is inside it, or the caret cannot be found. `cursorX` is the terminal cursor when it is on this
 * row; some agents hide it and draw the caret as an inverse cell instead.
 */
export function planRemoval(cells: RowCell[], needle: string, cursorX: number | undefined): RemovalPlan | undefined {
  const text = cells.map((c) => c.ch).join('');
  const offsets: number[] = [];
  let o = 0;
  for (const c of cells) {
    offsets.push(o);
    o += c.ch.length;
  }
  const at = text.indexOf(needle);
  if (at < 0 || text.indexOf(needle, at + 1) >= 0) return undefined;
  const indexAt = (offset: number): number => {
    const i = offsets.findIndex((v) => v >= offset);
    return i < 0 ? cells.length : i;
  };
  const start = indexAt(at);
  const end = indexAt(at + needle.length);
  let caret: number;
  if (cursorX !== undefined) {
    const i = cells.findIndex((c) => c.x >= cursorX);
    caret = i < 0 ? cells.length : i;
  } else {
    caret = cells.findIndex((c, i) => c.inverse && (i < start || i >= end));
    if (caret < 0) return undefined;
  }
  if (caret > start && caret < end) return undefined;
  return { moves: end - caret, width: end - start };
}

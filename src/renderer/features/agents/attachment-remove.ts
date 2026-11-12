/** One character cell of a screen row. */
export interface RowCell {
  x: number;
  ch: string;
  inverse: boolean;
}

/** One row of the message box: its cells, and the terminal cursor's column when the cursor is on this row. */
export interface MessageRow {
  cells: RowCell[];
  cursorX?: number;
}

/** `moves` is how far the caret must go to stand right after the text: positive = Right presses, negative = Left presses. */
export interface RemovalPlan {
  moves: number;
  /** Characters to delete with Backspace once the caret is there: the text, plus the space after it when that is included. */
  width: number;
}

interface Pos {
  row: number;
  i: number;
}

/** Any space counts: padding, a normal space, or the no-break space Claude Code puts after its `❯`. */
const isSpace = (ch: string | undefined) => ch !== undefined && /^\s$/u.test(ch);
const blank = (cells: RowCell[], from: number) => cells.slice(from).every((c) => isSpace(c.ch));
/** Where a row's text ends (padding after it does not count). */
const contentEnd = (cells: RowCell[]) => {
  let n = cells.length;
  while (n > 0 && isSpace(cells[n - 1]!.ch)) n--;
  return n;
};

/**
 * Matches `needle` starting at (row, i). A long `@path` is wrapped by the agent onto the next row(s): once part of it has
 * matched, at a row's end (only padding left) the match goes on at the next row's first non-blank cell, and a space of the
 * needle that the wrap swallowed is skipped (it still counts as a character to delete).
 */
function matchAt(rows: MessageRow[], needle: string, start: Pos): { end: Pos; width: number } | undefined {
  let { row, i } = start;
  let pos = 0;
  let width = 0;
  while (pos < needle.length) {
    const cells = rows[row]!.cells;
    const c = cells[i];
    if (c && needle.startsWith(c.ch, pos)) {
      pos += c.ch.length;
      width++;
      i++;
      continue;
    }
    // not a match here: only a wrap inside the text can explain it (never before its first character)
    if (pos === 0 || !blank(cells, i) || row + 1 >= rows.length) return undefined;
    while (needle[pos] === ' ') {
      pos++;
      width++;
    }
    row++;
    const next = rows[row]!.cells;
    i = 0;
    while (i < next.length && isSpace(next[i]!.ch) && needle[pos] !== ' ') i++;
    if (i >= next.length) return undefined;
  }
  return { end: { row, i }, width };
}

/**
 * An `@path` must stand on its own: `@src/a.ts` is not the start of `@src/a.tsx`, nor the end of `x@src/a.ts`.
 * (A placeholder like `[Image #1]` is delimited by its brackets already.)
 */
function standsAlone(rows: MessageRow[], needle: string, start: Pos, end: Pos): boolean {
  if (!needle.startsWith('@')) return true;
  const before = start.i > 0 ? rows[start.row]!.cells[start.i - 1]!.ch : ' ';
  const after = rows[end.row]!.cells[end.i]?.ch ?? ' ';
  return isSpace(before) && isSpace(after);
}

const before = (a: Pos, b: Pos) => a.row < b.row || (a.row === b.row && a.i < b.i);

/**
 * Where the caret is relative to `needle` (an `@path` or an `[Image #N]`) in the message box, so that deleting it can be done
 * with arrow keys and Backspace. The text may be wrapped over several rows. When it is there more than once (the same file
 * attached twice), `occurrence` says which one, counted in reading order. Undefined when it cannot be done safely: that
 * occurrence is not there, or the caret cannot be found. Some agents hide the terminal cursor and
 * draw the caret as an inverse cell instead.
 *
 * For an `@path` followed by a space on the same row, the space is taken too (it separated it from the next text), so that
 * removing one of several attachments does not leave a double space behind.
 */
export function planRemovalRows(rows: MessageRow[], needle: string, occurrence = 0): RemovalPlan | undefined {
  const found: Array<{ start: Pos; end: Pos; width: number }> = [];
  for (let row = 0; row < rows.length; row++) {
    for (let i = 0; i < rows[row]!.cells.length; i++) {
      const m = matchAt(rows, needle, { row, i });
      if (m && standsAlone(rows, needle, { row, i }, m.end)) found.push({ start: { row, i }, ...m });
    }
  }
  const hit = found[occurrence];
  if (!hit) return undefined;
  const { start, end } = hit;
  let { width } = hit;

  let caret: Pos | undefined;
  const cursorRow = rows.findIndex((r) => r.cursorX !== undefined);
  if (cursorRow >= 0) {
    const cells = rows[cursorRow]!.cells;
    const i = cells.findIndex((c) => c.x >= rows[cursorRow]!.cursorX!);
    caret = { row: cursorRow, i: i < 0 ? cells.length : i };
  } else {
    for (let row = 0; row < rows.length && !caret; row++) {
      const i = rows[row]!.cells.findIndex((c, i) => c.inverse && (before({ row, i }, start) || !before({ row, i }, end)));
      if (i >= 0) caret = { row, i };
    }
    if (!caret) return undefined;
  }
  // a caret inside the text is fine: the plan says to go on to its end (removing the attachment before it can leave the caret
  // at this one's start, and walking right passes through it). Backspace is only pressed once the caret is right behind it.

  // the space after an @path is real text (not row padding) when more text or the caret follows it on that row
  const endCells = rows[end.row]!.cells;
  let target = end;
  const spaceAfter =
    needle.startsWith('@') &&
    isSpace(endCells[end.i]?.ch) &&
    (!blank(endCells, end.i + 1) || (caret.row === end.row && caret.i > end.i));
  if (spaceAfter) {
    target = { row: end.row, i: end.i + 1 };
    width++;
  }

  // on the row where the text ends the distance is exact; from another row it is an estimate that only has to say which way
  // to go (the caller looks at the screen again after every key)
  const linear = (p: Pos) => rows.slice(0, p.row).reduce((n, r) => n + contentEnd(r.cells), 0) + p.i;
  let moves = caret.row === target.row ? target.i - caret.i : linear(target) - linear(caret);
  if (caret.row !== target.row && moves === 0) moves = caret.row > target.row ? -1 : 1;
  return { moves, width };
}

/** `planRemovalRows` for a single row; `cursorX` is the terminal cursor when it is on this row. */
export function planRemoval(cells: RowCell[], needle: string, cursorX: number | undefined): RemovalPlan | undefined {
  return planRemovalRows([{ cells, cursorX }], needle);
}

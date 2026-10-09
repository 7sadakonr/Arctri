import type { BlockSnapshot, CellStyle, StyledLine, StyledRun } from '@shared/types/block';

// Structural subsets of the xterm buffer API, satisfied by both @xterm/xterm and @xterm/headless.
export interface CellLike {
  getChars(): string;
  getWidth(): number;
  isFgDefault(): boolean;
  isFgRGB(): boolean;
  isFgPalette(): boolean;
  getFgColor(): number;
  isBgDefault(): boolean;
  isBgRGB(): boolean;
  isBgPalette(): boolean;
  getBgColor(): number;
  isBold(): number;
  isItalic(): number;
  isDim(): number;
  isUnderline(): number;
  isInverse(): number;
  isInvisible(): number;
  isStrikethrough(): number;
}
export interface LineLike {
  readonly length: number;
  readonly isWrapped: boolean;
  getCell(x: number, cell?: CellLike): CellLike | undefined;
}
export interface BufferLike {
  readonly length: number;
  readonly baseY: number;
  readonly cursorY: number;
  readonly cursorX: number;
  getLine(y: number): LineLike | undefined;
  getNullCell(): CellLike;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

function styleOf(c: CellLike): CellStyle {
  return {
    fg: c.isFgDefault() ? null : c.isFgRGB() ? hex(c.getFgColor()) : c.isFgPalette() ? `p${c.getFgColor()}` : null,
    bg: c.isBgDefault() ? null : c.isBgRGB() ? hex(c.getBgColor()) : c.isBgPalette() ? `p${c.getBgColor()}` : null,
    bold: !!c.isBold(),
    dim: !!c.isDim(),
    italic: !!c.isItalic(),
    underline: !!c.isUnderline(),
    inverse: !!c.isInverse(),
    strike: !!c.isStrikethrough(),
    invisible: !!c.isInvisible()
  };
}

/**
 * Converts buffer rows [start, end) into logical styled lines. Rows flagged `isWrapped`
 * continue the previous row, so the result reflows when the viewport is resized.
 */
export function snapshotRange(buffer: BufferLike, start: number, end: number, truncated = false): BlockSnapshot {
  const styles: CellStyle[] = [];
  const styleIndex = new Map<string, number>();
  const idx = (s: CellStyle): number => {
    const key = JSON.stringify(s);
    let i = styleIndex.get(key);
    if (i === undefined) {
      i = styles.length;
      styles.push(s);
      styleIndex.set(key, i);
    }
    return i;
  };

  const lines: StyledLine[] = [];
  let runs: StyledRun[] | undefined;
  let charCount = 0;
  const scratch = buffer.getNullCell();

  const push = (text: string, style: number) => {
    if (!text) return;
    const last = runs![runs!.length - 1];
    if (last && last.style === style) last.text += text;
    else runs!.push({ text, style });
    charCount += text.length;
  };

  for (let y = Math.max(0, start); y < Math.min(end, buffer.length); y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    if (!line.isWrapped || !runs) {
      runs = [];
      lines.push({ runs });
    }
    const next = buffer.getLine(y + 1);
    const continues = !!next && next.isWrapped && y + 1 < end;
    // Rows that continue onto the next one are full; otherwise trailing blanks are dropped.
    let last = line.length - 1;
    if (!continues) {
      while (last >= 0) {
        const c = line.getCell(last, scratch);
        if (c && (c.getChars() !== '' || !c.isBgDefault())) break;
        last--;
      }
    }
    for (let x = 0; x <= last; x++) {
      const c = line.getCell(x, scratch);
      if (!c || c.getWidth() === 0) continue;
      push(c.getChars() || ' ', idx(styleOf(c)));
    }
  }
  if (styles.length === 0) idx(styleOf(scratch));
  return { lines, styles, truncated, charCount };
}

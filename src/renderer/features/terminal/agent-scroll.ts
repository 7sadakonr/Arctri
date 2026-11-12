/**
 * Claude Code's fullscreen screen scrolls its transcript itself and never says where it is. The position is measured instead: how
 * far the text on screen moved between two looks (`measureShift`), plus the cue it shows while scrolled up ("Jump to bottom" / "N new
 * messages"). That gives a scroll bar that follows the text smoothly; dragging or clicking it is turned back into paging keys.
 * The length of the transcript is not known, so the top of the track is an estimate until the top has been reached.
 */
const SCROLLED_UP = /Jump to bottom|\d+ new messages?/;
/** The cue ends its row (it can share the row with transcript text); a sentence that merely mentions it does not. */
const CUE_AT_END = /(?:Jump to bottom|\d+ new messages?)(?: \(click\)|: [^\n]*)?\s*[↓⬇]?\s*$/;

/** The cue found at the end of a screen row, if any. */
export const scrollCue = (row: string): string | undefined => row.match(CUE_AT_END)?.[0].trim();

/** Lines one PageUp / PageDown moves in Claude Code (measured: about 11-12 on a 31-row screen). */
export const PAGE_LINES = 12;
/** Until the top is reached the track is this many screens long (the thumb then only creeps towards the top). */
const GUESS_SCREENS = 6;

/** Rows with something to recognise them by: not blank, not a rule or a lone symbol. */
const meaningful = (row: string): boolean => row.length >= 4 && /[\p{L}\p{N}]/u.test(row) && !SCROLLED_UP.test(row);

/**
 * How many rows the text moved between two looks at the transcript area: positive = it moved down (scrolled up, older text came
 * in), negative = up, 0 = it did not move, undefined = cannot tell (changed too much, or too few recognisable rows).
 *
 * Only rows that occur once on a screen are used (a transcript is full of repeated lines such as tool errors, which fit several
 * shifts), and the shift is the one most of them agree on.
 */
export function measureShift(prev: string[], cur: string[]): number | undefined {
  const uniqueRows = (rows: string[]): Map<string, number> => {
    const seen = new Map<string, number>();
    const dup = new Set<string>();
    rows.forEach((raw, i) => {
      const r = raw.trim();
      if (!meaningful(r)) return;
      if (seen.has(r)) dup.add(r);
      else seen.set(r, i);
    });
    for (const d of dup) seen.delete(d);
    return seen;
  };
  const before = uniqueRows(prev);
  const after = uniqueRows(cur);
  if (before.size === 0) return undefined;
  const votes = new Map<number, number>();
  let matched = 0;
  for (const [row, i] of before) {
    const j = after.get(row);
    if (j === undefined) continue;
    matched++;
    votes.set(j - i, (votes.get(j - i) ?? 0) + 1);
  }
  let best: { k: number; n: number } | undefined;
  for (const [k, n] of votes) if (!best || n > best.n || (n === best.n && Math.abs(k) < Math.abs(best.k))) best = { k, n };
  if (!best || best.n < 2 || best.n < 0.6 * matched) return undefined;
  // a still screen has most of its rows where they were; one that moved has few left in place
  return best.k;
}

export interface Thumb {
  top: number;
  height: number;
  /** False at the bottom: there is nothing known to scroll back to. */
  scrolled: boolean;
}

export class AgentScroll {
  private offset = 0;
  /** What was sent since the last look and not yet seen to happen: used only when the look cannot measure it. */
  private guess = 0;
  private scrolledUp = false;
  /** Offset of the top of the transcript, once an upward scroll was seen to go nowhere. */
  private topAt: number | undefined;
  /** An upward scroll was sent and no movement has been seen for it yet. */
  private pendingUp = false;

  /** A wheel turn: Claude Code moves about a line per event. Negative = up (towards older text). */
  wheel(lines: number): void {
    this.guess -= lines;
    if (lines < 0) this.pendingUp = true;
  }

  /** Only PageUp / PageDown scroll Claude Code (Home / End move its input caret). */
  key(key: string): void {
    if (key === 'PageUp') {
      this.guess += PAGE_LINES;
      this.pendingUp = true;
    } else if (key === 'PageDown') this.guess -= PAGE_LINES;
  }

  /**
   * A look at the screen: the cue rows found at the bottom, and how far the text moved since the last look (if it could be told).
   * `keepIfAbsent`: right after input the agent has not drawn its answer yet, so the cue's absence does not mean "at the bottom"
   * yet, and text that has not moved yet is not the top either.
   */
  screen(cueRows: string, shift?: number, keepIfAbsent = false): void {
    const up = SCROLLED_UP.test(cueRows);
    // text that went the opposite way of what was just sent is a mismeasure (the screen changed in other ways): use what was sent
    const contradicts = shift !== undefined && shift !== 0 && this.guess !== 0 && Math.sign(shift) !== Math.sign(this.guess);
    if (contradicts) shift = undefined;
    const moved = shift ?? this.guess;
    if (shift !== undefined && shift > 0) this.pendingUp = false;
    // an upward scroll that, once the agent had time, moved nothing: that is the top
    if (shift === 0 && this.pendingUp && !keepIfAbsent) {
      if (this.scrolledUp || up) this.topAt = this.offset;
      this.pendingUp = false;
    }
    this.offset = Math.max(0, this.offset + moved);
    this.guess = 0;
    if (this.topAt !== undefined && this.offset > this.topAt) this.topAt = undefined;
    if (up) {
      this.offset = Math.max(this.offset, 1);
      this.scrolledUp = true;
    } else if (!keepIfAbsent) {
      this.reset();
    }
  }

  reset(): void {
    this.offset = 0;
    this.guess = 0;
    this.scrolledUp = false;
    this.topAt = undefined;
    this.pendingUp = false;
  }

  /** Whether the transcript is known to be scrolled up. */
  get isScrolledUp(): boolean {
    return this.scrolledUp || this.offset > 0;
  }

  private height(track: number): number {
    return Math.min(track, Math.max(28, Math.round(track * 0.16)));
  }

  /** 0 at the bottom, 1 at the top. */
  private frac(offset: number, rows: number): number {
    if (this.topAt !== undefined && this.topAt > 0) return Math.min(1, offset / this.topAt);
    return offset / (Math.max(offset, GUESS_SCREENS * rows) + rows);
  }

  private offsetFor(frac: number, rows: number): number {
    if (this.topAt !== undefined && this.topAt > 0) return frac * this.topAt;
    const knee = (GUESS_SCREENS * rows) / ((GUESS_SCREENS + 1) * rows);
    return frac <= knee ? frac * (GUESS_SCREENS + 1) * rows : (frac * rows) / (1 - frac);
  }

  /** The thumb in a track `track` tall; `rows` is the number of visible rows. */
  thumb(track: number, rows: number): Thumb {
    const height = this.height(track);
    return {
      top: Math.round((1 - this.frac(this.offset, Math.max(1, rows))) * Math.max(0, track - height)),
      height,
      scrolled: this.offset > 0
    };
  }

  /** Pages to send (positive = PageUp) so that the thumb, dragged to `thumbTop`, matches where it is now. */
  pagesTo(thumbTop: number, track: number, rows: number): number {
    const room = Math.max(1, track - this.height(track));
    const f = Math.min(this.topAt !== undefined ? 1 : 0.95, Math.max(0, 1 - thumbTop / room));
    const target = this.offsetFor(f, Math.max(1, rows));
    return Math.round((target - (this.offset + this.guess)) / PAGE_LINES) || 0;
  }
}

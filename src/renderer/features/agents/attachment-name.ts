/**
 * Shortens a file name to at most `max` characters by cutting out its middle, so both the start and the end (where the
 * distinguishing part and the extension usually are) stay readable: `Screenshot 2026-11-12 at 03.52.59.png` →
 * `Screenshot 20…03.52.59.png`.
 */
const graphemes = (s: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);

export function middleEllipsis(name: string, max: number): string {
  const chars = graphemes(name); // whole characters, so a Thai vowel or tone mark never loses its consonant
  if (chars.length <= max || max < 3) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? graphemes(name.slice(dot)).length : 0;
  // keep the extension plus a few characters before it at the end; the start gets the rest
  const room = max - 1;
  const tail = Math.min(Math.max(Math.ceil(room / 2), ext + 4), room - 1);
  const head = room - tail;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

import { matchScore } from '@shared/completion/rank';

export interface Searchable<T> {
  item: T;
  /** Most important text first (the title); the rest only counts for a little. */
  fields: string[];
}

/** Ranks items against what was typed. Every word has to match somewhere; an empty query keeps the given order. */
export function filterRanked<T>(entries: Searchable<T>[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries.map((e) => e.item);
  const scored: Array<{ item: T; score: number; i: number }> = [];
  entries.forEach((e, i) => {
    let total = 0;
    for (const w of words) {
      let best = 0;
      e.fields.forEach((f, fi) => {
        const s = matchScore(f, w, true) * (fi === 0 ? 1 : 0.6);
        if (s > best) best = s;
      });
      if (best === 0) return void (total = -1e9);
      total += best;
    }
    if (total > 0) scored.push({ item: e.item, score: total, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.item);
}

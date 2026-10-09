import type { CompletionItem } from '../types/completion';

/** 0 = no match. Higher is better: exact > prefix > word boundary > subsequence. */
export function matchScore(candidate: string, query: string, caseInsensitive: boolean): number {
  if (!query) return 10;
  const c = caseInsensitive ? candidate.toLowerCase() : candidate;
  const q = caseInsensitive ? query.toLowerCase() : query;
  if (c === q) return 100;
  if (c.startsWith(q)) return 80 - Math.min(20, (c.length - q.length) / 4);
  const boundary = c.search(new RegExp(`[\\s/\\\\._-]${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (boundary >= 0) return 50;
  let qi = 0;
  for (let i = 0; i < c.length && qi < q.length; i++) if (c[i] === q[qi]) qi++;
  return qi === q.length ? 25 : 0;
}

export const SOURCE_WEIGHT: Record<CompletionItem['kind'], number> = {
  'git-subcommand': 1.15,
  'git-branch': 1.15,
  script: 1.15,
  flag: 1.0,
  command: 1.0,
  dir: 1.0,
  path: 0.95,
  history: 0.9
};

export function rankItems(items: CompletionItem[], limit: number): CompletionItem[] {
  const best = new Map<string, CompletionItem>();
  for (const it of items) {
    const key = `${it.replace[0]}:${it.replace[1]}:${it.insertText}`;
    const prev = best.get(key);
    if (!prev || it.score > prev.score) best.set(key, it);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.label.length - b.label.length || a.label.localeCompare(b.label))
    .slice(0, limit);
}

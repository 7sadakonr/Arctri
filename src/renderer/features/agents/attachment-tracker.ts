import type { Attachment } from '@shared/types/attachment';

export interface TrackedAttachment extends Attachment {
  id: string;
  addedAt: number;
  /** Placeholders ("[Image #1]") that were already in the message when this was added. */
  tokensBefore: string[];
  /** The placeholder the agent turned this attachment into. */
  token?: string;
  /** Seen in the message at least once. */
  seen: boolean;
}

export interface InputPatterns {
  prompt: RegExp;
  placeholder: RegExp;
}

/** The number in `[Image #N]` that the agent made of this attachment. */
export const numberOf = (a: Pick<TrackedAttachment, 'token'>): number | undefined => {
  const m = /#(\d+)/.exec(a.token ?? '');
  return m ? Number(m[1]) : undefined;
};

/** How long an attachment may stay unseen before it counts as gone (the agent has to draw it first). */
export const GRACE_MS = 3000;

const squash = (s: string): string => s.replace(/[\s│|╭╮╰╯─]/g, '');

/** The message box as text: from the last prompt line to the bottom of the screen. Undefined when no prompt is showing. */
export function inputRegion(lines: string[], prompt: RegExp): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (prompt.test(lines[i]!)) return lines.slice(i).join('\n');
  }
  return undefined;
}

/**
 * Compares the attachments with what the message box shows now and returns the ones that are still in it.
 * An attachment is in the message when its `@ref` or the placeholder the agent made of it is there. If the
 * prompt cannot be found (an approval is showing, say) nothing changes.
 */
export function reconcile(
  lines: string[],
  list: TrackedAttachment[],
  patterns: InputPatterns,
  now: number,
  /** Preview for a placeholder nobody here made (an image the user pasted with the agent's own key, like Alt+V). */
  onOrphan?: (token: string) => { name?: string; thumb?: string } | undefined
): TrackedAttachment[] {
  const region = inputRegion(lines, patterns.prompt);
  if (region === undefined) return list;
  const flat = squash(region);
  const tokens: string[] = region.match(patterns.placeholder) ?? [];
  const claimed = new Set(list.map((a) => a.token).filter((t): t is string => !!t));
  const out: TrackedAttachment[] = [];
  for (const a of list) {
    let token = a.token;
    const byRef = flat.includes(squash(a.ref));
    if (!byRef && !token && a.image) {
      token = tokens.find((t) => !claimed.has(t) && !a.tokensBefore.includes(t));
      if (token) claimed.add(token);
    }
    const present = byRef || (!!token && tokens.includes(token));
    if (present) out.push({ ...a, token, seen: true });
    else if (!a.seen && now - a.addedAt < GRACE_MS) out.push(a);
  }
  // placeholders nobody here made: the agent's own paste (Alt+V). They stay while the placeholder is in the message
  for (const token of new Set(tokens)) {
    if (claimed.has(token)) continue;
    const extra = onOrphan?.(token);
    out.push({
      id: `token-${token}`, ref: token, name: extra?.name ?? token.replace(/^\[|\]$/g, ''), image: true, thumb: extra?.thumb,
      addedAt: now, tokensBefore: [], token, seen: true
    });
  }
  return out;
}

/** The placeholders in the message box now (taken when an attachment is added, so later ones can be told apart). */
export function placeholdersIn(lines: string[], patterns: InputPatterns): string[] {
  const region = inputRegion(lines, patterns.prompt);
  return region ? (region.match(patterns.placeholder) ?? []) : [];
}

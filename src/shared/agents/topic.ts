/** Names an agent CLI sets as its window title when it has no subject: they say nothing about what it is doing. */
const GENERIC = new Set(['claude', 'claude code', 'codex', 'openai codex', 'codex cli']);

const MAX_TOPIC = 80;

/**
 * The subject of an agent's session, from the window title the CLI sets itself (OSC 0 / 2).
 * Only ever a label: it is not read for any status. Returns undefined when the title says nothing useful.
 */
export function cleanAgentTopic(raw: string): string | undefined {
  // control characters out; then the activity glyph some CLIs put in front (spinners, braille dots, stars, bullets)
  let t = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  t = t.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (!t) return undefined;
  if (GENERIC.has(t.toLowerCase())) return undefined;
  const chars = [...t];
  return chars.length > MAX_TOPIC ? `${chars.slice(0, MAX_TOPIC - 1).join('')}…` : t;
}

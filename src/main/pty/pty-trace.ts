import { appendFileSync } from 'node:fs';

/**
 * Debug aid: with ARCTRI_DEBUG_PTY=<file> every spawn size, resize and chunk of PTY output is appended to the file as JSON lines,
 * so a layout problem can be replayed exactly as the app saw it. Off (and free) when the variable is not set.
 */
const file = process.env['ARCTRI_DEBUG_PTY'];
const t0 = Date.now();

export function traceBlock(id: string, rec: { k: 'spawn' | 'resize' | 'data'; cols?: number; rows?: number; d?: string }): void {
  if (!file) return;
  try {
    appendFileSync(file, JSON.stringify({ t: Date.now() - t0, id, ...rec }) + '\n');
  } catch {
    /* tracing must never disturb a session */
  }
}

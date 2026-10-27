import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redact';

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 5;
let file: string | undefined;

function logFile(): string {
  if (file) return file;
  const dir = join(app.getPath('userData'), 'logs');
  mkdirSync(dir, { recursive: true });
  file = join(dir, 'arctri.log');
  return file;
}

function rotate(f: string): void {
  try {
    if (!existsSync(f) || statSync(f).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) if (existsSync(`${f}.${i}`)) renameSync(`${f}.${i}`, `${f}.${i + 1}`);
    renameSync(f, `${f}.1`);
  } catch {
    /* logging must never throw */
  }
}

function write(level: string, msg: string, extra?: unknown): void {
  try {
    const f = logFile();
    rotate(f);
    const detail = extra instanceof Error ? { error: extra.message, stack: extra.stack } : extra;
    // Paths and anything shaped like a secret are masked before they reach the disk.
    appendFileSync(f, redact(JSON.stringify({ t: new Date().toISOString(), level, msg, ...(detail ? { detail } : {}) })) + '\n');
  } catch {
    /* ignore */
  }
}

/** The last lines of the log, for the user to copy into a bug report. Already masked when written. */
export function logTail(lines = 200): string {
  try {
    const all = readFileSync(logFile(), 'utf8').split('\n').filter(Boolean);
    return redact(all.slice(-lines).join('\n'));
  } catch {
    return '';
  }
}

/** Terminal data is never logged; only lifecycle and errors. */
export const logger = {
  info: (m: string, x?: unknown) => write('info', m, x),
  warn: (m: string, x?: unknown) => write('warn', m, x),
  error: (m: string, x?: unknown) => write('error', m, x)
};

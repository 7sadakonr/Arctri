import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** What `/model` writes into the transcript the moment the user picks a model (before any reply carries the new model's id). */
const SET_MODEL = /Set model to `([^`\n]{1,80})`/g;
const POLL_MS = 500;
/** One pass reads at most this much of what was appended, so a burst of output never holds the main thread. */
const MAX_READ = 1024 * 1024;

/** The model named by the last `/model` result in `text`, if any. */
export function lastSetModel(text: string): string | undefined {
  let found: string | undefined;
  for (const m of text.matchAll(SET_MODEL)) found = m[1];
  return found;
}

/**
 * Follows the transcript of an agent session and reports each model the user picks with `/model`, as it happens.
 * It starts at the end of the file (what was said before is not replayed) and reads only what is appended.
 * Polled rather than watched: a transcript may live behind a `\\wsl.localhost` share where file watching is not reliable.
 */
export class TranscriptModelWatch {
  private timer?: ReturnType<typeof setInterval>;
  private offset: number | undefined;

  constructor(
    readonly file: string,
    private readonly onModel: (model: string) => void
  ) {}

  start(): void {
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private poll(): void {
    let fd: number | undefined;
    try {
      fd = openSync(this.file, 'r');
      const size = fstatSync(fd).size;
      if (this.offset === undefined || size < this.offset) {
        this.offset = size; // first look (or a file that was replaced): nothing before this point is news
        return;
      }
      if (size === this.offset) return;
      const len = Math.min(size - this.offset, MAX_READ);
      const buf = Buffer.alloc(len);
      const n = readSync(fd, buf, 0, len, this.offset);
      this.offset += n;
      const model = lastSetModel(buf.toString('utf8', 0, n));
      if (model) this.onModel(model);
    } catch {
      // not there yet, or not readable: try again on the next turn
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
}

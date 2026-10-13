export interface DataPumpOptions {
  intervalMs: number;
  maxBatch: number;
  high: number;
  low: number;
  /** How long a paused PTY waits for any acknowledgement before the pump stops waiting for one. */
  stallMs: number;
  /** Called when the wait above ran out, so it can be logged and counted. */
  onStall?: () => void;
}

const DEFAULTS: DataPumpOptions = { intervalMs: 8, maxBatch: 64 * 1024, high: 2 * 1024 * 1024, low: 512 * 1024, stallMs: 10_000 };

/**
 * Batches PTY output and applies back-pressure. The renderer acknowledges the
 * UTF-16 length it has finished writing into xterm; while too much is
 * outstanding the PTY is paused so the UI stays responsive on huge output.
 *
 * Acknowledgements can be lost (the page reloaded or crashed with chunks in flight), so a paused pump that
 * hears nothing for `stallMs` forgets what is outstanding and resumes. A live renderer keeps acknowledging and
 * the pump pauses again at the high-water mark, so the amount in flight stays bounded.
 */
export class DataPump {
  private buf: string[] = [];
  private size = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  private outstanding = 0;
  private paused = false;
  private disposed = false;
  private readonly opts: DataPumpOptions;

  constructor(
    private readonly send: (chunk: string) => void,
    private readonly pause: () => void,
    private readonly resume: () => void,
    opts: Partial<DataPumpOptions> = {}
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  push(chunk: string): void {
    if (this.disposed) return;
    this.buf.push(chunk);
    this.size += chunk.length;
    if (this.size >= this.opts.maxBatch) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.opts.intervalMs);
  }

  flush(): void {
    if (this.disposed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.size === 0) return;
    const data = this.buf.join('');
    this.buf = [];
    this.size = 0;
    this.outstanding += data.length;
    this.send(data);
    if (!this.paused && this.outstanding > this.opts.high) {
      this.paused = true;
      this.pause();
      this.armStallTimer();
    }
  }

  ack(length: number): void {
    if (this.disposed) return;
    this.outstanding = Math.max(0, this.outstanding - length);
    if (!this.paused) return;
    if (this.outstanding < this.opts.low) this.unpause();
    else this.armStallTimer(); // still paused, but the renderer is alive
  }

  /** Forgets what is outstanding, for a new port whose predecessor can no longer acknowledge anything. */
  resetCredit(): void {
    if (this.disposed) return;
    this.outstanding = 0;
    if (this.paused) this.unpause();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.buf = [];
    this.size = 0;
    if (this.paused) this.unpause();
    this.disposed = true;
  }

  private unpause(): void {
    this.paused = false;
    this.clearStallTimer();
    this.resume();
  }

  private armStallTimer(): void {
    this.clearStallTimer();
    this.stallTimer = setTimeout(() => {
      this.stallTimer = undefined;
      this.opts.onStall?.();
      this.resetCredit();
    }, this.opts.stallMs);
  }

  private clearStallTimer(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
  }
}

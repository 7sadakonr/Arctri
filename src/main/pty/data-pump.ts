/**
 * Batches PTY output and applies back-pressure. The renderer acknowledges the
 * UTF-16 length it has finished writing into xterm; while too much is
 * outstanding the PTY is paused so the UI stays responsive on huge output.
 */
export class DataPump {
  private buf: string[] = [];
  private size = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private outstanding = 0;
  private paused = false;

  constructor(
    private readonly send: (chunk: string) => void,
    private readonly pause: () => void,
    private readonly resume: () => void,
    private readonly opts = { intervalMs: 8, maxBatch: 64 * 1024, high: 2 * 1024 * 1024, low: 512 * 1024 }
  ) {}

  push(chunk: string): void {
    this.buf.push(chunk);
    this.size += chunk.length;
    if (this.size >= this.opts.maxBatch) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.opts.intervalMs);
  }

  flush(): void {
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
    }
  }

  ack(length: number): void {
    this.outstanding = Math.max(0, this.outstanding - length);
    if (this.paused && this.outstanding < this.opts.low) {
      this.paused = false;
      this.resume();
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.buf = [];
    this.size = 0;
  }
}

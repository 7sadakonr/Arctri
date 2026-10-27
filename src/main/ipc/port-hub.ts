import { MessageChannelMain, type BrowserWindow, type MessagePortMain } from 'electron';

/** Moves PTY output to the renderer over a dedicated MessagePort per session. */
export class PortHub {
  private ports = new Map<string, MessagePortMain>();
  private queue = new Map<string, string[]>();
  private queued = new Map<string, number>();

  /** Output held for a page that has not attached yet is capped; a window that never comes back must not grow without bound. */
  static readonly MAX_QUEUED_CHARS = 8 * 1024 * 1024;

  constructor(private readonly win: () => BrowserWindow | undefined) {}

  send(id: string, chunk: string): void {
    const port = this.ports.get(id);
    if (port) port.postMessage(chunk);
    else {
      const q = this.queue.get(id) ?? [];
      q.push(chunk);
      let size = (this.queued.get(id) ?? 0) + chunk.length;
      // keep the newest output: what a returning page needs to show is the recent part
      while (size > PortHub.MAX_QUEUED_CHARS && q.length > 1) size -= q.shift()!.length;
      this.queue.set(id, q);
      this.queued.set(id, size);
    }
  }

  /** Characters waiting for the page to attach (for tests and diagnostics). */
  pending(id: string): number {
    return this.queued.get(id) ?? 0;
  }

  attach(id: string): void {
    this.ports.get(id)?.close();
    const wc = this.win()?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    wc.postMessage('session:port', { id }, [port2]);
    port1.start();
    this.ports.set(id, port1);
    for (const chunk of this.queue.get(id) ?? []) port1.postMessage(chunk);
    this.queue.delete(id);
    this.queued.delete(id);
  }

  detach(id: string): void {
    this.ports.get(id)?.close();
    this.ports.delete(id);
    this.queue.delete(id);
    this.queued.delete(id);
  }
}

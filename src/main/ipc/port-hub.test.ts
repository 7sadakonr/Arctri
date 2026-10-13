import { describe, expect, it, vi } from 'vitest';

class FakePort {
  sent: string[] = [];
  closed = false;
  postMessage(m: string) { this.sent.push(m); }
  start() {}
  close() { this.closed = true; }
}
const channels: Array<{ port1: FakePort; port2: FakePort }> = [];
vi.mock('electron', () => ({
  MessageChannelMain: class {
    port1 = new FakePort();
    port2 = new FakePort();
    constructor() { channels.push(this); }
  },
  dialog: {}, Notification: {}, shell: {}
}));

import { PortHub } from './register';

const win = () => ({ webContents: { isDestroyed: () => false, postMessage: vi.fn() } }) as never;

describe('PortHub', () => {
  it('holds output that arrives before the first port and delivers it in order', () => {
    const hub = new PortHub(win);
    hub.send('a', '1');
    hub.send('a', '2');
    hub.attach('a');
    hub.send('a', '3');
    expect(channels.at(-1)!.port1.sent).toEqual(['1', '2', '3']);
  });

  it('keeps output made while the page is gone (reload or crash) and delivers it to the next port', () => {
    const hub = new PortHub(win);
    hub.attach('a');
    const first = channels.at(-1)!.port1;
    hub.send('a', 'before');
    hub.suspendAll();
    expect(first.closed).toBe(true);
    hub.send('a', 'during-1');
    hub.send('a', 'during-2');
    expect(first.sent).toEqual(['before']); // nothing is written into the dead page's port
    hub.attach('a');
    expect(channels.at(-1)!.port1.sent).toEqual(['during-1', 'during-2']);
  });

  it('forgets everything about a closed session', () => {
    const hub = new PortHub(win);
    hub.send('a', 'x');
    hub.detach('a');
    hub.attach('a');
    expect(channels.at(-1)!.port1.sent).toEqual([]);
  });
});

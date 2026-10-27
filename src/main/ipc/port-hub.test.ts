import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ MessageChannelMain: class {} }));

describe('PortHub', () => {
  it('keeps the newest output for a page that is not attached and forgets a detached session', async () => {
    const { PortHub } = await import('./port-hub');
    const hub = new PortHub(() => undefined);
    const chunk = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < 20; i++) hub.send('a', chunk);
    expect(hub.pending('a')).toBeLessThanOrEqual(PortHub.MAX_QUEUED_CHARS);
    expect(hub.pending('a')).toBeGreaterThan(PortHub.MAX_QUEUED_CHARS - 2 * chunk.length);
    hub.detach('a');
    expect(hub.pending('a')).toBe(0);
  });
});

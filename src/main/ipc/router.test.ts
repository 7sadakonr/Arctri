import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }));

const { validate, isTrustedSender, IpcError } = await import('./router');

describe('ipc validation', () => {
  it('accepts valid and rejects malformed arguments', () => {
    expect(validate('session:resize', { id: 'a', cols: 80, rows: 24 })).toEqual({ id: 'a', cols: 80, rows: 24 });
    expect(() => validate('session:resize', { id: 'a', cols: 0, rows: 24 })).toThrow(IpcError);
    expect(() => validate('session:write', { id: 'a', data: 5 })).toThrow(IpcError);
    expect(() => validate('session:create', { profileId: 'x', kind: 'shell', cols: 80, rows: 24, exe: 'cmd' })).not.toThrow();
  });

  it('does not let the renderer pass an executable to session:create', () => {
    const v = validate('session:create', { profileId: 'x', kind: 'shell', cols: 80, rows: 24, executable: 'calc.exe' } as never);
    expect(v).not.toHaveProperty('executable');
  });

  it('only trusts the app origin', () => {
    const ev = (url: string) => ({ senderFrame: { url } }) as never;
    const origins = ['file:///C:/app/out/renderer/index.html', 'http://localhost:5173'];
    expect(isTrustedSender(ev('file:///C:/app/out/renderer/index.html'), origins)).toBe(true);
    expect(isTrustedSender(ev('http://localhost:5173/'), origins)).toBe(true);
    expect(isTrustedSender(ev('https://evil.example/'), origins)).toBe(false);
    expect(isTrustedSender(ev('http://localhost:5173.evil.com/'), origins)).toBe(false);
    expect(isTrustedSender({ senderFrame: null } as never, origins)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { HistoryRepo } from './history-repo';
import { MemoryBackend, PrefsStore } from './prefs';
import { prefsPatchSchema } from '@shared/prefs';

describe('HistoryRepo', () => {
  const make = () => new HistoryRepo(openDb(':memory:').db, 5);

  it('records, searches by prefix and keeps environments apart', () => {
    const h = make();
    h.record({ envKey: 'windows:pwsh', command: 'git status', at: 1 });
    h.record({ envKey: 'windows:pwsh', command: 'git status', at: 3 });
    h.record({ envKey: 'windows:pwsh', command: 'git commit -m "แก้บั๊ก"', at: 2 });
    h.record({ envKey: 'wsl:Ubuntu:bash', command: 'git log', at: 4 });
    const r = h.search('windows:pwsh', 'git ', 10);
    expect(r.map((x) => x.command)).toEqual(['git status', 'git commit -m "แก้บั๊ก"']);
    expect(r[0]!.count).toBe(2);
    expect(h.search('windows:pwsh', 'git commit -m "แก้', 10)).toHaveLength(1);
  });

  it('ignores blank and space-prefixed commands and prunes to the limit', () => {
    const h = make();
    h.record({ envKey: 'k', command: ' secret', at: 1 });
    h.record({ envKey: 'k', command: '   ', at: 1 });
    for (let i = 0; i < 9; i++) h.record({ envKey: 'k', command: `cmd${i}`, at: i + 10 });
    expect(h.search('k', 'secret', 10)).toHaveLength(0);
    expect(h.recent('k', 100)).toEqual(['cmd8', 'cmd7', 'cmd6', 'cmd5', 'cmd4']);
  });
});

describe('PrefsStore', () => {
  it('applies defaults, validates and recovers from bad values', () => {
    const b = new MemoryBackend();
    b.set({ fontSize: 'big', language: 'th', scrollback: 50000 });
    const p = new PrefsStore(b);
    expect(p.get().language).toBe('th');
    expect(p.get().scrollback).toBe(50000);
    expect(p.get().fontSize).toBe(14);
    expect(() => p.set({ fontSize: 3 })).toThrow();
    expect(p.set({ theme: 'light' }).theme).toBe('light');
  });
});

describe('prefs patches', () => {
  it('only contain the keys that were sent, so saving one setting never resets another', () => {
    expect(prefsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' });
    expect(prefsPatchSchema.parse({})).toEqual({});
    expect(() => prefsPatchSchema.parse({ fontSize: 2 })).toThrow();
    const p = new PrefsStore(new MemoryBackend());
    p.set(prefsPatchSchema.parse({ language: 'th' }));
    p.set(prefsPatchSchema.parse({ theme: 'light' }));
    expect(p.get().language).toBe('th');
    expect(p.get().theme).toBe('light');
  });
});

describe('layout prefs', () => {
  it('defaults the UI scale and file panel width', () => {
    const p = new PrefsStore(new MemoryBackend()).get();
    expect(p.uiScale).toBe(1.1);
    expect(p.filePanelWidth).toBe(280);
  });

  it('rejects out-of-range values', () => {
    expect(prefsPatchSchema.safeParse({ uiScale: 3 }).success).toBe(false);
    expect(prefsPatchSchema.safeParse({ filePanelWidth: 100 }).success).toBe(false);
    expect(prefsPatchSchema.safeParse({ filePanelWidth: 400 }).success).toBe(true);
  });
});
